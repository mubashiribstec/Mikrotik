const express = require('express');
const ssh2 = require('ssh2');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const http = require('http');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(cors());
app.use(express.json());

// Rate limiting for login (prevent brute force)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method !== 'POST',
});

// Rate limiting for all API calls — 600/min allows 5-sec polling on all screens
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 600,
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// ========== SESSION & CONNECTION POOL ==========
const sessions = new Map();
const connections = new Map();

class RouterConnection {
  constructor(config) {
    this.config = config;
    this.conn = null;
    this.isConnected = false;
    this.lastActivity = Date.now();
    this._connectPromise = null; // mutex: prevents parallel connect races
  }

  async connect() {
    // If a connect is already in progress, wait for it instead of spawning another
    if (this._connectPromise) return this._connectPromise;

    this._connectPromise = new Promise((resolve, reject) => {
      const client = new ssh2.Client();
      let settled = false;

      const settle = (fn, arg) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this._connectPromise = null;
          fn(arg);
        }
      };

      const timer = setTimeout(() => {
        client.end();
        settle(reject, new Error('Connection timeout (30s)'));
      }, 30000);

      client.on('ready', () => {
        this.conn = client;
        this.isConnected = true;
        this.lastActivity = Date.now();
        settle(resolve);
      });

      client.on('error', (err) => {
        this.isConnected = false;
        this._connectPromise = null;
        settle(reject, new Error(`SSH Connection failed: ${err.message}`));
      });

      client.on('close', () => {
        this.isConnected = false;
        this._connectPromise = null;
      });

      client.connect({
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        password: this.config.password,
        readyTimeout: 30000,
        keepaliveInterval: 15000, // prevent RouterOS idle timeout
        keepaliveCountMax: 3,
        algorithms: {
          kex: [
            'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521',
            'diffie-hellman-group14-sha256', 'diffie-hellman-group14-sha1',
            'diffie-hellman-group1-sha1',
          ],
          cipher: [
            'aes128-ctr', 'aes192-ctr', 'aes256-ctr',
            'aes128-cbc', 'aes256-cbc', '3des-cbc',
          ],
          serverHostKey: [
            'ssh-rsa', 'ssh-dss', 'ecdsa-sha2-nistp256',
          ],
          hmac: ['hmac-sha2-256', 'hmac-sha1', 'hmac-md5'],
        },
      });
    });

    return this._connectPromise;
  }

  async execute(command) {
    if (!this.isConnected) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      this.conn.exec(command, (err, stream) => {
        if (err) {
          // SSH channel error — mark disconnected so next call reconnects
          this.isConnected = false;
          return reject(err);
        }

        const timeout = setTimeout(() => {
          stream.destroy();
          reject(new Error(`Command timed out: ${command}`));
        }, 25000);

        stream.on('close', () => {
          clearTimeout(timeout);
          this.lastActivity = Date.now();
          resolve(stdout + stderr);
        });

        stream.on('data', (data) => { stdout += data.toString(); });
        stream.stderr.on('data', (data) => { stderr += data.toString(); });
      });
    });
  }

  async close() {
    this.isConnected = false;
    this._connectPromise = null;
    if (this.conn) {
      try { this.conn.end(); } catch {}
      this.conn = null;
    }
  }
}

// ========== HELPERS ==========

function getConnection(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error('Invalid or expired session');
  return connections.get(sessionId);
}

// Parse RouterOS tabular print output.
// RouterOS format:
//   Flags: X - disabled, R - running
//    #   NAME              TYPE       MTU
//    0 R ether1            ether      1500
//    1   ether2            ether      1500
function parseRouterOSOutput(output) {
  if (!output || !output.trim()) return [];

  const lines = output.trim().split('\n').map(l => l.replace(/\r$/, ''));

  // Find the column-header line: first line that starts with optional spaces + '#'
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*#/.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    // No tabular header — fall through to key:value parser
    return parseRouterOSKeyValue(output);
  }

  const headerLine = lines[headerIdx];

  // Find position of '#' and record column start positions for every word after it
  const hashPos = headerLine.indexOf('#');
  const afterHash = headerLine.substring(hashPos + 1); // e.g. "   NAME   TYPE   MTU"
  const baseOffset = hashPos + 1;

  const columns = []; // { name: string, start: number }
  let inWord = false;
  let wordStart = 0;

  for (let c = 0; c < afterHash.length; c++) {
    if (afterHash[c] !== ' ') {
      if (!inWord) { inWord = true; wordStart = c; }
    } else {
      if (inWord) {
        inWord = false;
        columns.push({
          name: afterHash.substring(wordStart, c).toLowerCase().replace(/-/g, '_'),
          start: baseOffset + wordStart,
        });
      }
    }
  }
  if (inWord) {
    columns.push({
      name: afterHash.substring(wordStart).trim().toLowerCase().replace(/-/g, '_'),
      start: baseOffset + wordStart,
    });
  }

  const rows = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    // Data rows start with optional spaces followed by a digit
    if (!/^\s*\d/.test(line)) continue;

    // Extract row index number
    const indexMatch = line.match(/^\s*(\d+)/);
    const rowIndex = indexMatch ? indexMatch[1] : '';

    // Extract flag characters (letters between the index and the first column)
    let flags = '';
    if (columns.length > 0 && indexMatch) {
      const flagsArea = line.substring(indexMatch[0].length, columns[0].start);
      flags = flagsArea.replace(/\s/g, '');
    }

    const row = {
      numbers: rowIndex,
      _flags: flags,
      running: flags.includes('R') ? 'true' : 'false',
      disabled: flags.includes('X') ? 'true' : 'false',
    };

    for (let j = 0; j < columns.length; j++) {
      const { name, start } = columns[j];
      const end = j + 1 < columns.length ? columns[j + 1].start : undefined;
      row[name] = (end !== undefined ? line.substring(start, end) : line.substring(start) || '').trim();
    }

    rows.push(row);
  }

  return rows;
}

// Parse RouterOS key: value output (e.g. /system resource print, /ip dns print)
function parseRouterOSKeyValue(output) {
  if (!output || !output.trim()) return [];

  const row = {};
  for (const line of output.trim().split('\n')) {
    // Match lines like "   uptime: 1d2h3m" or "cpu-load: 5"
    const m = line.match(/^\s+([\w-]+):\s*(.*)$/);
    if (m) {
      row[m[1].toLowerCase().replace(/-/g, '_')] = m[2].trim();
    }
  }
  return Object.keys(row).length > 0 ? [row] : [];
}

// ========== SHARED DATA FETCHERS ==========
// These are called by both REST handlers and the WebSocket broadcaster.

async function fetchSystemStats(conn) {
  const output = await conn.execute('/system resource print');
  const kv = parseRouterOSKeyValue(output)[0] || {};

  const totalMemory = parseInt(kv.total_memory) || 0;
  const freeMemory = parseInt(kv.free_memory) || 0;
  const memoryUsed = totalMemory - freeMemory;
  const memoryPercent = totalMemory > 0 ? Math.round((memoryUsed / totalMemory) * 100) : 0;

  const totalHdd = parseInt(kv.total_hdd_space) || 0;
  const freeHdd = parseInt(kv.free_hdd_space) || 0;
  const hddUsed = totalHdd - freeHdd;
  const storagePercent = totalHdd > 0 ? Math.round((hddUsed / totalHdd) * 100) : 0;

  const cpuLoad = parseInt(kv.cpu_load) || 0;

  const fmtMB = (b) => b >= 1073741824 ? `${(b/1073741824).toFixed(1)} GB` : `${(b/1048576).toFixed(0)} MB`;

  return {
    cpu: Math.max(0, Math.min(100, cpuLoad)),
    memory: Math.max(0, Math.min(100, memoryPercent)),
    storage: Math.max(0, Math.min(100, storagePercent)),
    uptime: kv.uptime || 'unknown',
    model: kv.board_name || '',
    version: kv.version || '',
    memoryDetail: totalMemory > 0 ? `${fmtMB(memoryUsed)} / ${fmtMB(totalMemory)}` : '',
    storageDetail: totalHdd > 0 ? `${fmtMB(hddUsed)} / ${fmtMB(totalHdd)}` : '',
    cpuCount: parseInt(kv.cpu_count) || 1,
  };
}

async function fetchInterfaces(conn) {
  const output = await conn.execute('/interface print');
  const ifaces = parseRouterOSOutput(output);

  let statsRows = [];
  try {
    const statsOut = await conn.execute('/interface print stats');
    statsRows = parseRouterOSOutput(statsOut);
  } catch (e) { /* optional */ }

  // Fetch IP addresses to enrich each interface entry
  let addrRows = [];
  try {
    addrRows = parseRouterOSOutput(await conn.execute('/ip address print'));
  } catch (e) { /* optional */ }

  return ifaces.map(iface => {
    const stats = statsRows.find(s => s.name === iface.name) || {};
    const addr  = addrRows.find(a => a.interface === iface.name) || {};
    return {
      name:       iface.name || 'unknown',
      type:       iface.type || 'ether',
      status:     iface.running === 'true' ? 'up' : 'down',
      disabled:   iface.disabled === 'true',
      comment:    iface.comment || '',
      macAddress: iface.mac_address || '',
      mtu:        iface.actual_mtu || iface.mtu || '',
      address:    addr.address || '',
      util: 0,
      rxBytes: parseInt(stats.rx_byte) || 0,
      txBytes: parseInt(stats.tx_byte) || 0,
    };
  });
}

async function fetchWanStatus(conn) {
  const addrOutput = await conn.execute('/ip address print');
  const addresses = parseRouterOSOutput(addrOutput);

  const ifOutput = await conn.execute('/interface print');
  const ifaces = parseRouterOSOutput(ifOutput);

  // Identify WAN interfaces by type, name convention, or comment
  const wanNames = new Set();
  ifaces.forEach(iface => {
    const type    = (iface.type || '').toLowerCase();
    const comment = (iface.comment || '').toLowerCase();
    const name    = (iface.name || '').toLowerCase();
    if (
      type === 'pppoe-out' || type === 'l2tp-out' || type === 'pptp-out' ||
      comment.includes('wan') || name.includes('wan') || name === 'ether1'
    ) {
      wanNames.add(iface.name);
    }
  });

  const filtered = wanNames.size > 0
    ? addresses.filter(a => wanNames.has(a.interface))
    : addresses;

  return (filtered.length > 0 ? filtered : addresses).map((addr, idx) => {
    const iface = ifaces.find(i => i.name === addr.interface);
    return {
      name:    addr.interface || `WAN${idx + 1}`,
      status:  iface ? (iface.running === 'true' ? 'up' : 'down') : 'unknown',
      util:    0,
      ip:      addr.address || '0.0.0.0/24',
      comment: addr.comment || iface?.comment || '',
      weight:  1,
    };
  });
}

async function fetchFirewall(conn) {
  const rulesOutput = await conn.execute('/ip firewall filter print');
  const rules = parseRouterOSOutput(rulesOutput);

  const blocked = rules
    .filter(r => (r.action === 'drop' || r.action === 'reject') && r.comment)
    .map(r => r.comment);

  let activeConnections = 0;
  try {
    const connOut = await conn.execute('/ip firewall connection print count-only');
    activeConnections = parseInt(connOut.trim()) || 0;
  } catch (e) { /* optional */ }

  let droppedPackets = 0;
  try {
    const statsOut = await conn.execute('/ip firewall filter print stats');
    const statsRows = parseRouterOSOutput(statsOut);
    for (const statsRow of statsRows) {
      // Stats output may or may not include the action column; fall back to matching rule
      let action = (statsRow.action || '').toLowerCase();
      if (!action) {
        const matchingRule = rules.find(r => r.numbers === statsRow.numbers);
        action = (matchingRule?.action || '').toLowerCase();
      }
      if (action === 'drop' || action === 'reject') {
        // RouterOS formats large numbers with spaces: "16 543 045" → strip spaces
        const pkts = parseInt((statsRow.packets || '').replace(/[\s,]/g, '')) || 0;
        droppedPackets += pkts;
      }
    }
  } catch (e) { /* optional */ }

  return {
    blocked: blocked.length > 0 ? blocked : ['(No drop rules configured)'],
    activeConnections: Math.max(0, activeConnections),
    droppedPackets: Math.max(0, droppedPackets),
  };
}

async function fetchBandwidth(conn) {
  const output = await conn.execute('/queue simple print');
  const queues = parseRouterOSOutput(output);

  let statsRows = [];
  try {
    const statsOut = await conn.execute('/queue simple print stats');
    statsRows = parseRouterOSOutput(statsOut);
  } catch {}

  const data = queues.map(q => {
    const prio = parseInt(q.priority) || 8;
    const priorityLabel = prio <= 3 ? 'high' : prio <= 5 ? 'normal' : 'low';
    const stats = statsRows.find(s => s.name === q.name) || {};
    const rxBytes = parseInt(stats.bytes ? stats.bytes.split('/')[0] : 0) || 0;
    const txBytes = parseInt(stats.bytes ? stats.bytes.split('/')[1] : 0) || 0;
    return {
      name:     q.name || 'queue',
      target:   q.target || 'all',
      down:     q.max_limit ? q.max_limit.split('/')[0] : 'unlimited',
      up:       q.max_limit ? q.max_limit.split('/')[1] : 'unlimited',
      priority: priorityLabel,
      util:     0,
      rxBytes,
      txBytes,
      packets: stats.packets || '0/0',
      dropped: stats.dropped || '0/0',
    };
  });

  return data.length > 0 ? data : [];
}

async function fetchDhcpClients(conn) {
  const output = await conn.execute('/ip dhcp-server lease print');
  const clients = parseRouterOSOutput(output);

  let arpData = [];
  try {
    arpData = parseRouterOSOutput(await conn.execute('/ip arp print'));
  } catch (e) { /* optional */ }

  return clients.map(client => {
    // expires-after format: "23h59m55s" or "3d23h..."
    let leaseHours = '24h';
    if (client.expires_after) {
      const d = parseInt(client.expires_after.match(/(\d+)d/)?.[1]) || 0;
      const h = parseInt(client.expires_after.match(/(\d+)h/)?.[1]) || 0;
      leaseHours = `${d * 24 + h}h`;
    }

    let vendor = 'Device';
    const arp = arpData.find(a => a.mac_address === client.mac_address);
    if (arp && arp.comment) vendor = arp.comment.substring(0, 20);

    // host-name comes from DHCP option 12 sent by the client
    const hostname = client.host_name || client.comment || '';

    return {
      hostname,
      vendor,
      ip:    client.address     || '0.0.0.0',
      mac:   client.mac_address || '00:00:00:00:00:00',
      iface: client.interface   || 'bridge',
      lease: leaseHours,
      tx: 0,
      rx: 0,
    };
  });
}

async function fetchWireless(conn) {
  const output = await conn.execute('/interface wireless print');
  const ifaces = parseRouterOSOutput(output);

  let clients = [];
  try {
    clients = parseRouterOSOutput(await conn.execute('/interface wireless registration-table print'));
  } catch (e) { /* no wireless or not supported */ }

  return ifaces.map(iface => {
    const connectedClients = clients.filter(c => c.interface === iface.name).length;
    let freq = '2.4 GHz';
    if ((iface.band || '').includes('5') || (iface.name || '').includes('5')) freq = '5 GHz';

    return {
      name: iface.name || 'wlan0',
      freq,
      clients: Math.max(0, connectedClients),
      signal: 0,
    };
  });
}

async function fetchVpn(conn) {
  const result = {
    wireguard: { enabled: false, interfaces: [], peers: [] },
    l2tp: { enabled: false, peers: 0 },
    ovpn: { enabled: false, peers: 0 },
  };

  // WireGuard
  try {
    const wgIfaces = parseRouterOSOutput(await conn.execute('/interface wireguard print'));
    if (wgIfaces.length > 0) {
      result.wireguard.enabled = true;
      result.wireguard.interfaces = wgIfaces.map(wg => ({
        name: wg.name,
        port: parseInt(wg.listen_port) || 51820,
        disabled: wg.disabled === 'true',
        publicKey: wg.public_key || '',
        mtu: wg.mtu || '1420',
      }));

      // Fetch WireGuard peers
      try {
        const peerOut = await conn.execute('/interface wireguard peers print detail');
        const peerRows = parseRouterOSOutput(peerOut);
        result.wireguard.peers = peerRows.map(p => ({
          interface: p.interface || '',
          name: p.comment || p.public_key?.substring(0, 8) || '(unnamed)',
          publicKey: p.public_key || '',
          allowedAddress: p.allowed_address || '',
          lastHandshake: p.last_handshake_time || 'never',
          rx: parseInt(p.rx) || 0,
          tx: parseInt(p.tx) || 0,
          enabled: p.disabled !== 'true',
          endpoint: p.endpoint_address ? `${p.endpoint_address}:${p.endpoint_port || '51820'}` : '',
        }));
      } catch {}
    }
  } catch {}

  // L2TP
  try {
    const l2tpOut = await conn.execute('/interface l2tp-server server print');
    const l2tp = parseRouterOSKeyValue(l2tpOut)[0] || {};
    result.l2tp.enabled = l2tp.enabled === 'yes';
    if (result.l2tp.enabled) {
      try {
        const conns = parseRouterOSOutput(await conn.execute('/interface l2tp-server print'));
        result.l2tp.peers = conns.length;
      } catch {}
    }
  } catch {}

  // OpenVPN server (RouterOS 7+ only)
  try {
    const ovpnOut = await conn.execute('/interface ovpn-server server print');
    const ovpn = parseRouterOSKeyValue(ovpnOut)[0] || {};
    result.ovpn.enabled = ovpn.enabled === 'yes';
    if (result.ovpn.enabled) {
      try {
        const conns = parseRouterOSOutput(await conn.execute('/interface ovpn-server print'));
        result.ovpn.peers = conns.length;
      } catch {}
    }
  } catch {}

  return result;
}

async function fetchLogs(conn) {
  const output = await conn.execute('/log print');
  const data = [];

  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.trim().split(/\s+/);
    const timestamp = `${parts[0] || ''} ${parts[1] || ''}`.trim();
    const rest = parts.slice(2).join(' ');

    let topic = 'system';
    if (line.includes('interface')) topic = 'interface';
    else if (line.includes('firewall')) topic = 'firewall';
    else if (line.includes('dhcp') || line.includes('lease')) topic = 'dhcp';
    else if (line.includes('wireless') || line.includes('wlan')) topic = 'wireless';
    else if (line.includes('vpn') || line.includes('ipsec')) topic = 'vpn';

    let source = 'system';
    if (line.includes('ether')) source = 'ether';
    else if (line.includes('wlan')) source = 'wireless';
    else if (line.includes('dhcp')) source = 'DHCP';

    data.push({ time: timestamp, topic, source, msg: rest.substring(0, 100) });
  }

  return data.slice(-50).reverse();
}

// Rolling traffic history per session (28 data-points, updated each poll)
const trafficHistory = new Map();

async function fetchTraffic(sessionId, conn) {
  const statsOut = await conn.execute('/interface print stats');
  const ifaces = parseRouterOSOutput(statsOut);

  let totalRx = 0, totalTx = 0;
  for (const iface of ifaces) {
    totalRx += parseInt(iface.rx_byte) || 0;
    totalTx += parseInt(iface.tx_byte) || 0;
  }

  const now = Date.now();

  if (!trafficHistory.has(sessionId)) {
    trafficHistory.set(sessionId, {
      rx: new Array(28).fill(0),
      tx: new Array(28).fill(0),
      lastRx: totalRx,
      lastTx: totalTx,
      lastTime: now,
    });
    return { rx: new Array(28).fill(0), tx: new Array(28).fill(0) };
  }

  const hist = trafficHistory.get(sessionId);
  const elapsed = Math.max(1, (now - hist.lastTime) / 1000);

  // Convert bytes/s to Kbps
  const rxKbps = Math.max(0, Math.round(((totalRx - hist.lastRx) * 8) / elapsed / 1024));
  const txKbps = Math.max(0, Math.round(((totalTx - hist.lastTx) * 8) / elapsed / 1024));

  hist.rx = [...hist.rx.slice(1), rxKbps];
  hist.tx = [...hist.tx.slice(1), txKbps];
  hist.lastRx = totalRx;
  hist.lastTx = totalTx;
  hist.lastTime = now;

  return { rx: hist.rx, tx: hist.tx };
}

// ========== AUTH ENDPOINTS ==========

app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const { host, port = 22, username, password } = req.body;

    if (!host || !username || !password) {
      return res.status(400).json({ error: 'Missing credentials: host, username, password required' });
    }

    if (host.length > 255 || username.length > 255 || password.length > 255) {
      return res.status(400).json({ error: 'Invalid input length' });
    }

    const config = { host, port: parseInt(port), username, password };

    // Open the connection once and KEEP IT — don't open+close+open a second one
    const conn = new RouterConnection(config);
    try {
      await conn.connect();
      await conn.execute('/system identity print'); // verify credentials work
    } catch (err) {
      try { conn.close(); } catch {}
      return res.status(401).json({ error: `Connection failed: ${err.message}` });
    }

    const sessionId = Math.random().toString(36).substring(7);
    sessions.set(sessionId, {
      sessionId, host, port: parseInt(port), username,
      createdAt: Date.now(), lastActivity: Date.now(),
    });
    connections.set(sessionId, conn);

    // Periodic cleanup — check every 30 minutes, remove if inactive for 2 hours
    const cleanupInterval = setInterval(() => {
      const sess = sessions.get(sessionId);
      if (!sess || Date.now() - sess.lastActivity > 7200000) {
        clearInterval(cleanupInterval);
        const c = connections.get(sessionId);
        if (c) c.close();
        sessions.delete(sessionId);
        connections.delete(sessionId);
        trafficHistory.delete(sessionId);
      }
    }, 30 * 60 * 1000);

    res.json({ sessionId, message: 'Connected successfully', router: `${host}:${port}` });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/logout', (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'No session' });

    const conn = connections.get(sessionId);
    if (conn) conn.close();

    sessions.delete(sessionId);
    connections.delete(sessionId);
    trafficHistory.delete(sessionId);

    res.json({ message: 'Logged out' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== PROTECTED API ENDPOINTS ==========

app.use('/api/', apiLimiter);

// Touch session activity on every authenticated request
app.use('/api/', (req, res, next) => {
  const sessionId = req.headers['x-session-id'];
  if (sessionId) {
    const sess = sessions.get(sessionId);
    if (sess) sess.lastActivity = Date.now();
  }
  next();
});

app.get('/api/system-stats', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    res.json(await fetchSystemStats(getConnection(sessionId)));
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/interfaces', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    res.json(await fetchInterfaces(getConnection(sessionId)));
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/wan-status', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const data = await fetchWanStatus(getConnection(sessionId));
    res.json(data.length > 0 ? data : [{ name: 'ether2', status: 'unknown', util: 0, ip: 'not-configured' }]);
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/firewall', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    res.json(await fetchFirewall(getConnection(sessionId)));
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bandwidth', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    res.json(await fetchBandwidth(getConnection(sessionId)));
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dhcp-clients', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const data = await fetchDhcpClients(getConnection(sessionId));
    res.json(data.length > 0 ? data : [
      { hostname: '', vendor: 'Device', ip: '192.168.1.100', mac: '00:00:00:00:00:00', iface: 'ether1', lease: '24h', tx: 0, rx: 0 },
    ]);
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/wireless', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const data = await fetchWireless(getConnection(sessionId));
    res.json(data.length > 0 ? data : [{ name: 'wlan0', freq: '2.4 GHz', clients: 0, signal: 0 }]);
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vpn', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    res.json(await fetchVpn(getConnection(sessionId)));
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    res.json(await fetchLogs(getConnection(sessionId)));
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/scripts', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);
    const output = await conn.execute('/system script print');
    const scripts = parseRouterOSOutput(output);

    const data = scripts.map(s => ({
      name: s.name || 'unknown',
      lastRun: s.last_started || 'never',
      runCount: parseInt(s.run_count) || 0,
      policy: s.policy || '',
    }));

    res.json(data.length > 0 ? data : []);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/backups', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);
    const output = await conn.execute('/file print');
    const files = parseRouterOSOutput(output);

    const backupFiles = files.filter(f =>
      f.name && (f.name.endsWith('.backup') || f.name.endsWith('.bin'))
    );

    const data = backupFiles.slice(0, 10).map(file => {
      let sizeStr = '0 MB';
      const sizeBytes = parseInt(file.size);
      if (!isNaN(sizeBytes)) {
        sizeStr = (sizeBytes / (1024 * 1024)).toFixed(1) + ' MB';
      }

      let trigger = 'Manual';
      if (file.name && (file.name.includes('scheduled') || file.name.includes('auto') || file.name.includes('daily'))) {
        trigger = 'Scheduled';
      }

      return {
        filename: file.name || 'unknown.backup',
        size: sizeStr,
        timestamp: file.creation_time || file.modification_time || new Date().toLocaleString(),
        trigger,
      };
    });

    if (data.length === 0) {
      const today = new Date().toISOString().split('T')[0];
      data.push({ filename: `backup-${today}.backup`, size: '0 MB', timestamp: new Date().toLocaleString(), trigger: 'Manual' });
    }

    res.json(data);
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== IP ADDRESSES ==========

app.get('/api/ip-addresses', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);
    const output = await conn.execute('/ip address print');
    const addresses = parseRouterOSOutput(output);

    const data = addresses.map(addr => ({
      id: addr.numbers || '',
      address: addr.address || '',
      interface: addr.interface || '',
      disabled: addr.disabled === 'true',
      comment: addr.comment || '',
    }));

    res.json(data.length > 0 ? data : [
      { id: '0', address: '192.168.1.1/24', interface: 'ether1', disabled: false, comment: 'LAN' },
    ]);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/ip-addresses/add', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { address, interface: iface, comment } = req.body;
    if (!address || !iface) return res.status(400).json({ error: 'Address and interface required' });
    if (!/^\d+\.\d+\.\d+\.\d+(\/\d+)?$/.test(address)) return res.status(400).json({ error: 'Invalid IP address format' });

    const conn = getConnection(sessionId);
    await conn.execute(`/ip address add address=${address} interface=${iface}${comment ? ` comment="${comment}"` : ''}`);

    res.json({ success: true, message: 'IP address added' });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/ip-addresses/remove', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID required' });

    await getConnection(sessionId).execute(`/ip address remove numbers=${id}`);
    res.json({ success: true, message: 'IP address removed' });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ========== ROUTES ==========

app.get('/api/routes', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);
    const output = await conn.execute('/ip route print');
    const routes = parseRouterOSOutput(output);

    const data = routes.map(route => ({
      id: route.numbers || '',
      destination: route.dst_address || '',
      gateway: route.gateway || '',
      distance: route.distance || '0',
      disabled: route.disabled === 'true',
      comment: route.comment || '',
    }));

    res.json(data.length > 0 ? data : [
      { id: '0', destination: '0.0.0.0/0', gateway: '', distance: '0', disabled: false, comment: 'Default route' },
    ]);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/routes/add', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { destination, gateway, distance, comment } = req.body;
    if (!destination || !gateway) return res.status(400).json({ error: 'Destination and gateway required' });
    if (!/^\d+\.\d+\.\d+\.\d+(\/\d+)?$/.test(destination)) return res.status(400).json({ error: 'Invalid destination format' });

    let cmd = `/ip route add dst-address=${destination} gateway=${gateway}`;
    if (distance) cmd += ` distance=${distance}`;
    if (comment) cmd += ` comment="${comment}"`;

    await getConnection(sessionId).execute(cmd);
    res.json({ success: true, message: 'Route added' });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/routes/remove', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Route ID required' });

    await getConnection(sessionId).execute(`/ip route remove numbers=${id}`);
    res.json({ success: true, message: 'Route removed' });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ========== DNS ==========

app.get('/api/dns', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);
    const output = await conn.execute('/ip dns print');
    const kv = parseRouterOSKeyValue(output)[0] || {};

    res.json({
      servers: (kv.servers || '').split(',').map(s => s.trim()).filter(Boolean),
      allowRemoteRequests: kv.allow_remote_requests === 'yes',
      cacheSize: parseInt(kv.cache_size) || 2048,
      cacheMaxTtl: kv.cache_max_ttl || '1w',
      comment: kv.comment || '',
    });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/dns/update', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { servers, allowRemoteRequests, flush } = req.body;
    const conn = getConnection(sessionId);

    if (flush) {
      await conn.execute('/ip dns cache flush');
      return res.json({ success: true, message: 'DNS cache flushed' });
    }

    if (!Array.isArray(servers) || servers.length === 0) {
      return res.status(400).json({ error: 'At least one DNS server required' });
    }

    const cmd = `/ip dns set servers=${servers.join(',')} allow-remote-requests=${allowRemoteRequests ? 'yes' : 'no'}`;
    await conn.execute(cmd);
    res.json({ success: true, message: 'DNS settings updated' });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ========== NAT ==========

app.get('/api/nat', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);
    const output = await conn.execute('/ip firewall nat print');
    const rules = parseRouterOSOutput(output);

    const data = rules.map(rule => ({
      id: rule.numbers || '',
      chain: rule.chain || 'srcnat',
      srcAddress: rule.src_address || '',
      dstAddress: rule.dst_address || '',
      protocol: rule.protocol || '',
      action: rule.action || 'masquerade',
      disabled: rule.disabled === 'true',
      comment: rule.comment || '',
    }));

    res.json(data.length > 0 ? data : []);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/nat/add', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { chain, srcAddress, dstAddress, action, protocol, comment } = req.body;
    if (!chain || !action) return res.status(400).json({ error: 'Chain and action required' });

    let cmd = `/ip firewall nat add chain=${chain} action=${action}`;
    if (srcAddress) cmd += ` src-address=${srcAddress}`;
    if (dstAddress) cmd += ` dst-address=${dstAddress}`;
    if (protocol) cmd += ` protocol=${protocol}`;
    if (comment) cmd += ` comment="${comment}"`;

    await getConnection(sessionId).execute(cmd);
    res.json({ success: true, message: 'NAT rule added' });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/nat/remove', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Rule ID required' });

    await getConnection(sessionId).execute(`/ip firewall nat remove numbers=${id}`);
    res.json({ success: true, message: 'NAT rule removed' });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ========== DNS STATIC ENTRIES ==========

app.get('/api/dns/static', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const conn = getConnection(sessionId);
    const out = await conn.execute('/ip dns static print');
    const rows = parseRouterOSOutput(out);
    res.json(rows.map(r => ({
      id: r.numbers || '',
      name: r.name || '',
      address: r.address || r.data || '',
      ttl: r.ttl || '',
      type: r.type || 'A',
      disabled: r.disabled === 'true',
      matchSubdomain: r.match_subdomain === 'yes',
      comment: r.comment || '',
    })));
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/dns/static/add', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { name, address, type = 'A', ttl, comment, matchSubdomain } = req.body;
    if (!name || !address) return res.status(400).json({ error: 'Name and address required' });
    if (!/^[a-zA-Z0-9._*-]{1,253}$/.test(name)) return res.status(400).json({ error: 'Invalid domain name' });

    const conn = getConnection(sessionId);
    let cmd = `/ip dns static add name="${name}" address=${address} type=${type}`;
    if (matchSubdomain) cmd += ' match-subdomain=yes';
    if (ttl) cmd += ` ttl=${ttl}`;
    if (comment) cmd += ` comment="${comment}"`;

    const out = await conn.execute(cmd);
    if (rosError(out)) return res.status(500).json({ error: out.trim().split('\n')[0] });
    res.json({ success: true, message: `DNS entry for ${name} added` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/dns/static/remove', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID required' });
    const conn = getConnection(sessionId);
    const out = await conn.execute(`/ip dns static remove numbers=${id}`);
    if (rosError(out)) return res.status(500).json({ error: out.trim().split('\n')[0] });
    res.json({ success: true, message: 'DNS entry removed' });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== MASQUERADE ==========

app.get('/api/masquerade', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);
    const output = await conn.execute('/ip firewall nat print');
    const rules = parseRouterOSOutput(output);

    const masq = rules.find(r => r.action === 'masquerade');
    if (masq) {
      res.json({
        enabled: masq.disabled !== 'true',
        srcAddress: masq.src_address || '',
        outInterface: masq.out_interface || '',
        protocols: masq.protocol ? [masq.protocol] : [],
        comment: masq.comment || '',
      });
    } else {
      res.json({ enabled: false, srcAddress: '', outInterface: '', protocols: [], comment: '' });
    }
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/masquerade/toggle', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { enabled } = req.body;
    const cmd = `/ip firewall nat set [find action=masquerade] disabled=${enabled ? 'no' : 'yes'}`;
    await getConnection(sessionId).execute(cmd);
    res.json({ success: true, message: `Masquerade ${enabled ? 'enabled' : 'disabled'}` });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ========== HOTSPOT ==========

app.get('/api/hotspot', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);

    const output = await conn.execute('/ip hotspot print');
    const hotspots = parseRouterOSOutput(output);

    let activeUsers = 0;
    try {
      const activeOut = await conn.execute('/ip hotspot active print count-only');
      activeUsers = parseInt(activeOut.trim()) || 0;
    } catch (e) { /* optional */ }

    let profiles = [];
    try {
      const profOut = await conn.execute('/ip hotspot profile print');
      const profRows = parseRouterOSOutput(profOut);
      profiles = profRows.map(p => ({
        id: p.numbers || '',
        name: p.name || 'default',
        comment: p.comment || '',
      }));
    } catch (e) { /* optional */ }

    res.json({
      enabled: hotspots.length > 0 && hotspots[0].disabled !== 'true',
      activeUsers,
      profiles,
    });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/hotspot/users', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);
    const output = await conn.execute('/ip hotspot user print');
    const users = parseRouterOSOutput(output);

    // Fetch active sessions to enrich with live IP and uptime
    let activeSessions = [];
    try {
      activeSessions = parseRouterOSOutput(await conn.execute('/ip hotspot active print'));
    } catch (e) { /* optional */ }

    const hsData = users.map(u => {
      const active = activeSessions.find(a => a.user === u.name);
      return {
        id:       u.numbers || '',
        name:     u.name || '',
        type:     'hotspot',
        profile:  u.profile || 'default',
        disabled: u.disabled === 'true',
        comment:  u.comment || '',
        address:  active?.address || '',
        uptime:   active?.uptime  || '',
        bytesIn:  parseInt((active?.bytes_in || '').replace(/[\s,]/g, '')) || 0,
      };
    });

    // Also merge PPPoE secrets so the PPPoE tab has data
    let pppoeData = [];
    try {
      const pppoeRows = parseRouterOSOutput(await conn.execute('/ppp secret print'));
      let pppoeActive = [];
      try {
        pppoeActive = parseRouterOSOutput(await conn.execute('/ppp active print'));
      } catch (e) { /* optional */ }

      pppoeData = pppoeRows.map(p => {
        const active = pppoeActive.find(a => a.name === p.name);
        return {
          id:       `pppoe-${p.numbers || ''}`,
          name:     p.name || '',
          type:     'pppoe',
          profile:  p.profile || 'default',
          disabled: p.disabled === 'true',
          comment:  p.comment || '',
          address:  active?.address || '',
          uptime:   active?.uptime  || '',
          bytesIn:  0,
        };
      });
    } catch (e) { /* PPPoE not configured */ }

    res.json([...hsData, ...pppoeData]);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/hotspot/user/add', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { username, password, profile, comment } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    let cmd = `/ip hotspot user add name="${username}" password="${password}" profile=${profile || 'default'}`;
    if (comment) cmd += ` comment="${comment}"`;

    await getConnection(sessionId).execute(cmd);
    res.json({ success: true, message: 'Hotspot user added' });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/hotspot/user/remove', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'User ID required' });

    await getConnection(sessionId).execute(`/ip hotspot user remove numbers=${id}`);
    res.json({ success: true, message: 'Hotspot user removed' });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ========== SCRIPT EXECUTION ==========

const scriptExecutions = new Map();

const ALLOWED_SCRIPTS = new Set([
  'system_info', 'daily_backup', 'health_check', 'cleanup_logs',
  'interface_monitor', 'bandwidth_report', 'firewall_stats', 'dhcp_status',
  'wireless_monitor', 'vpn_check', 'system_update_check', 'backup_restore',
  'reset_interface', 'restart_service', 'check_dns',
]);

app.post('/api/scripts/execute', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { scriptName } = req.body;
    if (!scriptName || typeof scriptName !== 'string') {
      return res.status(400).json({ error: 'Invalid script name format' });
    }
    if (!ALLOWED_SCRIPTS.has(scriptName)) {
      return res.status(403).json({ error: 'Script not allowed' });
    }

    const executionId = Math.random().toString(36).substring(7);
    const execution = {
      executionId, scriptName, status: 'running',
      output: '', exitCode: null, startedAt: Date.now(), sessionId,
    };
    scriptExecutions.set(executionId, execution);

    (async () => {
      try {
        const conn = getConnection(sessionId);
        execution.output = await conn.execute(`/system script run name="${scriptName}"`);
        execution.status = 'done';
        execution.exitCode = 0;
      } catch (err) {
        execution.output = `Error: ${err.message}`;
        execution.status = 'error';
        execution.exitCode = 1;
      }
    })();

    res.json({ executionId, status: 'queued' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/scripts/:executionId/output', (req, res) => {
  try {
    const execution = scriptExecutions.get(req.params.executionId);
    if (!execution) return res.status(404).json({ error: 'Execution not found' });

    const elapsed = Date.now() - execution.startedAt;
    res.json({
      executionId: execution.executionId,
      status: execution.status,
      output: execution.output,
      exitCode: execution.exitCode,
      elapsed,
    });

    if (elapsed > 600000) scriptExecutions.delete(req.params.executionId);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== TRAFFIC & DIAGNOSTICS ==========

app.get('/api/traffic', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    res.json(await fetchTraffic(sessionId, getConnection(sessionId)));
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/top-talkers', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);

    // Use DHCP leases as the authoritative list of active clients
    const output = await conn.execute('/ip dhcp-server lease print');
    const leases = parseRouterOSOutput(output);

    // RouterOS does not expose per-client bandwidth without accounting;
    // report the client list with zero rx/tx (accurate, not fabricated).
    const data = leases.slice(0, 5).map(l => ({
      ip: l.address || '0.0.0.0',
      mac: l.mac_address || '',
      rx: 0,
      tx: 0,
    }));

    res.json(data.length > 0 ? data : [{ ip: '0.0.0.0', mac: '', rx: 0, tx: 0 }]);
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', sessions: sessions.size, timestamp: new Date().toISOString() });
});

// ========== INTERFACE TOGGLE ==========

app.post('/api/interfaces/toggle', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { name, disable } = req.body;
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Interface name required' });

    const action = disable ? 'disable' : 'enable';
    await getConnection(sessionId).execute(`/interface ${action} "${name}"`);
    res.json({ success: true, message: `Interface "${name}" ${action}d` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== INTERFACES — RENAME & MAC RESET ==========

app.post('/api/interfaces/rename', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { name, newName } = req.body;
    if (!name || !newName) return res.status(400).json({ error: 'name and newName required' });
    if (!/^[a-zA-Z0-9._-]{1,30}$/.test(newName)) return res.status(400).json({ error: 'Invalid interface name' });
    const conn = getConnection(sessionId);
    const out = await conn.execute(`/interface set [find name="${name}"] name="${newName}"`);
    if (/failure|error|bad command/i.test(out)) return res.status(500).json({ error: out.trim().split('\n')[0] });
    res.json({ success: true, message: `Renamed ${name} → ${newName}` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/interfaces/reset-mac', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Interface name required' });
    const conn = getConnection(sessionId);
    const out = await conn.execute(`/interface ethernet reset-mac-address "${name}"`);
    if (/failure|error|bad command/i.test(out)) return res.status(500).json({ error: out.trim().split('\n')[0] });
    res.json({ success: true, message: `MAC address reset for ${name}` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== SCRIPTS — ADD/REMOVE ==========

app.post('/api/scripts/add', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { name, source, policy } = req.body;
    if (!name || !source) return res.status(400).json({ error: 'name and source required' });
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(name)) return res.status(400).json({ error: 'Invalid script name' });
    const conn = getConnection(sessionId);
    const pol = policy || 'read,write,policy,test';
    const out = await conn.execute(`/system script add name="${name}" policy="${pol}" source="${source.replace(/"/g, '\\"')}"`);
    if (/failure|error|bad command/i.test(out)) return res.status(500).json({ error: out.trim().split('\n')[0] });
    res.json({ success: true, message: `Script "${name}" added` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scripts/remove', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Script name required' });
    const conn = getConnection(sessionId);
    const out = await conn.execute(`/system script remove [find name="${name}"]`);
    if (/failure|error|bad command/i.test(out)) return res.status(500).json({ error: out.trim().split('\n')[0] });
    res.json({ success: true, message: `Script "${name}" removed` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== USERS — /ip user management ==========

app.get('/api/users', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const conn = getConnection(sessionId);
    const out = await conn.execute('/ip user print');
    const users = parseRouterOSOutput(out);
    res.json(users.map(u => ({
      id: u.numbers || '',
      name: u.name || '',
      group: u.group || 'read',
      address: u.address || '',
      disabled: u.disabled === 'true',
      comment: u.comment || '',
      lastLogin: u.last_logged_in || '',
    })));
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/add', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { name, password, group = 'read', comment } = req.body;
    if (!name || !password) return res.status(400).json({ error: 'name and password required' });
    if (!/^[a-zA-Z0-9._-]{1,32}$/.test(name)) return res.status(400).json({ error: 'Invalid username' });
    const conn = getConnection(sessionId);
    let cmd = `/ip user add name="${name}" password="${password}" group=${group}`;
    if (comment) cmd += ` comment="${comment}"`;
    const out = await conn.execute(cmd);
    if (/failure|error|bad command/i.test(out)) return res.status(500).json({ error: out.trim().split('\n')[0] });
    res.json({ success: true, message: `User "${name}" added` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/remove', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Username required' });
    const conn = getConnection(sessionId);
    const out = await conn.execute(`/ip user remove [find name="${name}"]`);
    if (/failure|error|bad command/i.test(out)) return res.status(500).json({ error: out.trim().split('\n')[0] });
    res.json({ success: true, message: `User "${name}" removed` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/set-password', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { name, password } = req.body;
    if (!name || !password) return res.status(400).json({ error: 'name and password required' });
    const conn = getConnection(sessionId);
    const out = await conn.execute(`/ip user set [find name="${name}"] password="${password}"`);
    if (/failure|error|bad command/i.test(out)) return res.status(500).json({ error: out.trim().split('\n')[0] });
    res.json({ success: true, message: `Password updated for ${name}` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== FIREWALL — SERVICE BLOCK/UNBLOCK ==========

// RouterOS sends errors as stdout text (conn.execute always resolves).
// This detects RouterOS application errors in command output.
function rosError(output) {
  return /^\s*(failure|bad command|no such item|syntax error|input does not match|invalid value)/im.test(output);
}

// Server-authoritative domain lists — never trust client-sent domains.
// Only base/parent domains are listed; with match-subdomain=yes (RouterOS 7.6+)
// one DNS static entry covers ALL subdomains. We still list separate CDN/auxiliary
// domains because they're different base names (not subdomains of each other).
const BLOCK_SERVICE_DOMAINS = {
  youtube:  ['youtube.com', 'youtu.be', 'googlevideo.com', 'ytimg.com', 'ggpht.com', 'youtube-nocookie.com'],
  facebook: ['facebook.com', 'fbcdn.net', 'instagram.com', 'fb.com', 'messenger.com', 'whatsapp.net'],
  tiktok:   ['tiktok.com', 'tiktokcdn.com', 'tiktokv.com', 'musical.ly', 'bytedance.com'],
  netflix:  ['netflix.com', 'nflxvideo.net', 'nflximg.net', 'nflxext.com', 'nflxso.net'],
  adult:    ['pornhub.com', 'xvideos.com', 'xnxx.com', 'xhamster.com', 'redtube.com', 'youporn.com'],
  torrents: ['thepiratebay.org', '1337x.to', 'rarbg.to', 'nyaa.si', 'kickasstorrents.to', 'torrentgalaxy.to'],
  gambling: ['bet365.com', 'pokerstars.com', '888casino.com', 'draftkings.com', 'fanduel.com', 'betway.com'],
  crypto:   ['coinhive.com', 'cryptoloot.pro', 'minero.cc', 'jsecoin.com'],
};

// Standard well-known DoH endpoints — when blocking is active and the user wants
// to prevent DoH bypass, these are added to a shared address-list and dropped.
const DOH_ENDPOINTS = [
  'cloudflare-dns.com', 'mozilla.cloudflare-dns.com', 'one.one.one.one',
  'dns.google', 'dns.google.com', 'dns.quad9.net',
  'doh.opendns.com', 'doh.cleanbrowsing.org', 'dns.nextdns.io',
  'doh.dns.sb', 'security.cloudflare-dns.com', 'family.cloudflare-dns.com',
];

// Standard RouterOS community Layer-7 bittorrent regexp
// Escaping note: each \\ in this JS string becomes \ in the sent SSH command,
// which RouterOS then interprets in its regexp engine.
const L7_TORRENT_REGEXP = `^(\\\\x13bittorrent protocol|azver\\\\x01\\$|get /scrape\\\\\\?info_hash=get /announce\\\\\\?info_hash=|get /client/bitcomet/|GET /data\\\\\\?fid=)|d1:ad2:id20:|\\\\x08'7P\\\\)[RP]`;

async function blockTorrentsL7(conn) {
  const comment = 'netforge-svc-torrents';

  // 1. Layer-7 protocol pattern
  const l7AddOut = await conn.execute(`/ip firewall layer7-protocol add name="netforge-layer7-torrent" comment="${comment}" regexp="${L7_TORRENT_REGEXP}"`);
  if (rosError(l7AddOut)) {
    await conn.execute(`/ip firewall layer7-protocol set [find name="netforge-layer7-torrent"] regexp="${L7_TORRENT_REGEXP}" comment="${comment}"`);
  }

  // 2. Mark L7-detected torrent sources into address list (skip if duplicate)
  const f1Out = await conn.execute(`/ip firewall filter add action=add-src-to-address-list address-list=netforge-torrent-conn address-list-timeout=2m chain=forward layer7-protocol=netforge-layer7-torrent comment="${comment}"`);
  if (rosError(f1Out)) { /* already exists, skip */ }

  // 3. Mark P2P-detected sources into address list
  const f2Out = await conn.execute(`/ip firewall filter add action=add-src-to-address-list address-list=netforge-torrent-conn address-list-timeout=2m chain=forward p2p=all-p2p comment="${comment}"`);
  if (rosError(f2Out)) { /* already exists, skip */ }

  // 4. Drop TCP to non-standard ports for marked sources
  const f3Out = await conn.execute(`/ip firewall filter add action=drop chain=forward dst-port=!0-1024,8291,5900,5800,3389 protocol=tcp src-address-list=netforge-torrent-conn comment="${comment}"`);
  if (rosError(f3Out)) { /* already exists, skip */ }

  // 5. Drop UDP to non-standard ports for marked sources
  const f4Out = await conn.execute(`/ip firewall filter add action=drop chain=forward dst-port=!0-1024,8291,5900,5800,3389 protocol=udp src-address-list=netforge-torrent-conn comment="${comment}"`);
  if (rosError(f4Out)) { /* already exists, skip */ }

  // 6. Also DNS-block known torrent site domains
  for (const domain of (BLOCK_SERVICE_DOMAINS.torrents || [])) {
    const dnsOut = await conn.execute(`/ip dns static add name="${domain}" address=0.0.0.0 comment="${comment}"`);
    if (rosError(dnsOut)) {
      await conn.execute(`/ip dns static set [find name="${domain}"] address=0.0.0.0 comment="${comment}"`);
    }
  }
}

async function unblockTorrentsL7(conn) {
  try { await conn.execute('/ip firewall filter remove [find comment="netforge-svc-torrents"]'); } catch {}
  try { await conn.execute('/ip firewall layer7-protocol remove [find comment="netforge-svc-torrents"]'); } catch {}
  try { await conn.execute('/ip firewall address-list remove [find list="netforge-torrent-conn"]'); } catch {}
  try { await conn.execute('/ip dns static remove [find comment="netforge-svc-torrents"]'); } catch {}
}

// Returns which service IDs are currently blocked
app.get('/api/firewall/service-status', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);

    // Collect what's blocked via each method
    const methods = {}; // svcId → 'dns'|'mangle'|'layer7'

    // --- DNS check: domain-name matching (tabular print omits comment column) ---
    const dnsOut = await conn.execute('/ip dns static print');
    const dnsEntries = parseRouterOSOutput(dnsOut);
    const blockedDomains = new Set();
    for (const e of dnsEntries) {
      const addr = (e.address || e.data || '').trim();
      if (addr === '0.0.0.0') blockedDomains.add((e.name || '').toLowerCase());
    }

    // --- Mangle/address-list check ---
    const alOut = await conn.execute('/ip firewall address-list print');

    // --- Layer-7 check ---
    const l7Out = await conn.execute('/ip firewall layer7-protocol print');

    const blocked = [];
    for (const [svcId, domains] of Object.entries(BLOCK_SERVICE_DOMAINS)) {
      const comment = `netforge-svc-${svcId}`;

      // Check DNS
      if (domains.some(d => blockedDomains.has(d.toLowerCase()))) {
        blocked.push(svcId); methods[svcId] = 'dns'; continue;
      }
      // Check address-list (mangle method)
      if (alOut.includes(comment)) {
        blocked.push(svcId); methods[svcId] = 'mangle'; continue;
      }
      // Check Layer-7
      if (l7Out.includes(comment)) {
        blocked.push(svcId); methods[svcId] = 'layer7'; continue;
      }
    }

    res.json({ blocked, methods });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Block or unblock a service
app.post('/api/firewall/service/toggle', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { serviceId, block, blockMethod = 'dns' } = req.body;
    if (!serviceId) return res.status(400).json({ error: 'serviceId required' });

    const domains = BLOCK_SERVICE_DOMAINS[serviceId];
    if (!domains || domains.length === 0) {
      return res.status(400).json({ error: `Unknown service: ${serviceId}` });
    }

    const conn = getConnection(sessionId);
    const comment = `netforge-svc-${serviceId}`;

    // Always remove existing entries for this service first so toggling between
    // methods or re-applying never silently fails on duplicates. The raw chain
    // is also cleaned here because that's where our drop rules now live.
    if (block) {
      try { await conn.execute(`/ip dns static remove [find comment="${comment}"]`); } catch {}
      try { await conn.execute(`/ip firewall filter remove [find comment="${comment}"]`); } catch {}
      try { await conn.execute(`/ip firewall raw remove [find comment="${comment}"]`); } catch {}
      try { await conn.execute(`/ip firewall mangle remove [find comment="${comment}"]`); } catch {}
      try { await conn.execute(`/ip firewall layer7-protocol remove [find name="${comment}"]`); } catch {}
      try { await conn.execute(`/ip firewall address-list remove [find comment="${comment}"]`); } catch {}
      try { await conn.execute(`/ip firewall address-list remove [find comment="${comment}-src"]`); } catch {}
    }

    const report = { method: blockMethod, steps: [] };

    // Helper: read back a chain and confirm our comment shows up in the output.
    // RouterOS `print detail` includes the comment column even when tabular hides it.
    const verifyRule = async (chainCmd) => {
      const out = await conn.execute(`${chainCmd} print detail`);
      return out.includes(`comment="${comment}"`) || out.includes(`comment=${comment}`);
    };

    if (block) {
      // --------------------------------------------------------------------
      // LAYER-7 METHOD
      // L7 cannot run in /ip firewall raw (raw is pre-conntrack). So:
      //   1. /ip firewall layer7-protocol — add the pattern
      //   2. /ip firewall mangle prerouting — when L7 matches, add SOURCE to
      //      a per-service address list with 30m timeout
      //   3. /ip firewall raw prerouting    — drop everything from that list
      // This is the standard MikroTik wiki pattern for L7 domain blocking.
      // --------------------------------------------------------------------
      if (blockMethod === 'layer7') {
        if (serviceId === 'torrents') {
          await blockTorrentsL7(conn);
          report.steps.push({ ok: true, name: 'torrent L7+P2P rules installed' });
        } else {
          // Match keyword bytes (e.g. 'youtube') in HTTP host header / TLS SNI
          const pattern = domains.slice(0, 5)
            .map(d => d.split('.')[0])
            .filter(Boolean)
            .join('|');
          const regexp = `(${pattern})`;
          const srcList = `${comment}-src`;

          // 1. L7 protocol
          const l7Out = await conn.execute(`/ip firewall layer7-protocol add name="${comment}" comment="${comment}" regexp="${regexp}"`);
          if (rosError(l7Out)) {
            return res.status(500).json({ error: `Failed to add Layer-7 protocol: ${l7Out.trim().split('\n')[0]}`, report });
          }
          report.steps.push({ ok: true, name: `Layer-7 protocol added (regex: ${regexp})` });

          // 2. Mangle: when L7 detects pattern, add source IP to short-term block list
          const mOut = await conn.execute(`/ip firewall mangle add chain=prerouting layer7-protocol="${comment}" action=add-src-to-address-list address-list="${srcList}" address-list-timeout=30m comment="${comment}"`);
          if (rosError(mOut)) {
            return res.status(500).json({ error: `Mangle rule failed: ${mOut.trim().split('\n')[0]}`, report });
          }
          report.steps.push({ ok: true, name: `mangle: L7 match → ${srcList} (30m TTL)` });

          // 3. Raw drop: kills traffic from any source on the block list.
          // Raw is processed BEFORE filter / defconf rules — no positioning needed.
          const rOut = await conn.execute(`/ip firewall raw add chain=prerouting src-address-list="${srcList}" action=drop comment="${comment}"`);
          if (rosError(rOut)) {
            return res.status(500).json({ error: `Raw drop rule failed: ${rOut.trim().split('\n')[0]}`, report });
          }
          report.steps.push({ ok: true, name: 'raw-drop rule installed (pre-conntrack)' });

          // 4. DNS fallback — L7 only inspects ~10 packets / 2KB and misses DoH/DoT
          for (const domain of domains) {
            await conn.execute(`/ip dns static add name="${domain}" address=0.0.0.0 type=A comment="${comment}"`);
          }
          report.steps.push({ ok: true, name: `${domains.length} DNS fallback entries added` });
        }

      // --------------------------------------------------------------------
      // MANGLE / ADDRESS-LIST METHOD
      // Use /ip firewall raw instead of /ip firewall filter for the drop rule.
      // Raw is processed BEFORE conntrack and the filter chain, so we don't
      // need place-before (which fails on RouterOS 7 with 'no such item').
      // --------------------------------------------------------------------
      } else if (blockMethod === 'mangle') {
        let alAdded = 0;
        const alErrors = [];
        for (const domain of domains) {
          const out = await conn.execute(`/ip firewall address-list add list="${comment}" address="${domain}" comment="${comment}"`);
          if (rosError(out)) {
            alErrors.push(`${domain}: ${out.trim().split('\n')[0]}`);
          } else {
            alAdded++;
          }
        }
        report.steps.push({ ok: alAdded > 0, name: `address-list: ${alAdded}/${domains.length} domains added`, errors: alErrors.slice(0, 3) });

        if (alAdded === 0) {
          return res.status(500).json({ error: `Could not add any domains to address-list. RouterOS: ${alErrors[0] || 'unknown'}`, report });
        }

        // Raw drop rule — chain is empty by default, no place-before needed
        const rOut = await conn.execute(`/ip firewall raw add chain=prerouting dst-address-list="${comment}" action=drop comment="${comment}"`);
        if (rosError(rOut)) {
          return res.status(500).json({ error: `Address list created but DROP rule failed: ${rOut.trim().split('\n')[0]}`, report });
        }
        report.steps.push({ ok: true, name: 'raw-drop rule installed (pre-conntrack, no chain-order dependency)' });

      // --------------------------------------------------------------------
      // DNS METHOD (default)
      // Multi-layered: DNS static + NAT-redirect to force-through router DNS
      // + DROP external DNS (so 8.8.8.8 / 1.1.1.1 don't bypass)
      // No place-before — RouterOS 7 throws 'no such item' on empty chains.
      // --------------------------------------------------------------------
      } else {
        try { await conn.execute('/ip dns set allow-remote-requests=yes'); } catch {}

        // Force LAN DNS traffic through the router (intercepts clients using 8.8.8.8 directly)
        const natOut = await conn.execute('/ip firewall nat print');
        if (!natOut.includes('netforge-dns-redirect')) {
          const n1 = await conn.execute('/ip firewall nat add chain=dstnat protocol=udp dst-port=53 action=redirect to-ports=53 comment="netforge-dns-redirect"');
          const n2 = await conn.execute('/ip firewall nat add chain=dstnat protocol=tcp dst-port=53 action=redirect to-ports=53 comment="netforge-dns-redirect"');
          if (rosError(n1) || rosError(n2)) {
            report.steps.push({ ok: false, name: 'NAT redirect failed', error: (rosError(n1) ? n1 : n2).trim().split('\n')[0] });
          } else {
            report.steps.push({ ok: true, name: 'DNS NAT redirect installed (port-53 intercept)' });
          }
        } else {
          report.steps.push({ ok: true, name: 'DNS NAT redirect already in place' });
        }

        // Add static entries with match-subdomain=yes (RouterOS 7.6+)
        let added = 0;
        const errors = [];
        for (const domain of domains) {
          const addOut = await conn.execute(`/ip dns static add name="${domain}" match-subdomain=yes address=0.0.0.0 type=A comment="${comment}"`);
          if (rosError(addOut)) {
            // Fallback without match-subdomain for older RouterOS
            const addOut2 = await conn.execute(`/ip dns static add name="${domain}" address=0.0.0.0 type=A comment="${comment}"`);
            if (rosError(addOut2)) {
              const setOut = await conn.execute(`/ip dns static set [find name="${domain}"] address=0.0.0.0 type=A comment="${comment}"`);
              if (rosError(setOut)) errors.push(`${domain}: ${setOut.trim().split('\n')[0]}`);
              else added++;
            } else { added++; }
          } else { added++; }
        }

        // Verify by re-reading the router state
        const verifyOut = await conn.execute('/ip dns static print');
        const verifyEntries = parseRouterOSOutput(verifyOut);
        const verified = verifyEntries.filter(e =>
          (e.address || e.data) === '0.0.0.0' && domains.includes((e.name || '').toLowerCase())
        ).length;

        report.steps.push({ ok: verified > 0, name: `DNS entries: ${added} added, ${verified} verified on router`, errors: errors.slice(0, 3) });

        if (verified === 0) {
          return res.status(500).json({ error: `Could not write any DNS entries. RouterOS: ${errors[0] || 'no error returned'}`, report });
        }
      }
    } else {
      // UNBLOCK — clean all four chains (raw, filter, mangle, layer7) and both
      // address lists (`comment` and the `-src` list used by the L7 method)
      try { await conn.execute(`/ip dns static remove [find comment="${comment}"]`); } catch {}
      try { await conn.execute(`/ip firewall raw remove [find comment="${comment}"]`); } catch {}
      try { await conn.execute(`/ip firewall filter remove [find comment="${comment}"]`); } catch {}
      try { await conn.execute(`/ip firewall mangle remove [find comment="${comment}"]`); } catch {}
      try { await conn.execute(`/ip firewall layer7-protocol remove [find name="${comment}"]`); } catch {}
      try { await conn.execute(`/ip firewall address-list remove [find comment="${comment}"]`); } catch {}
      try { await conn.execute(`/ip firewall address-list remove [find list="${comment}-src"]`); } catch {}
      if (serviceId === 'torrents') await unblockTorrentsL7(conn);
    }

    try { await conn.execute('/ip dns cache flush'); } catch {}

    res.json({
      success: true,
      message: `${serviceId} ${block ? `blocked via ${blockMethod}` : 'unblocked'}`,
      report,
    });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== FIREWALL — BLOCK DOMAIN ==========

app.post('/api/firewall/block-domain', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { domain, method } = req.body;
    if (!domain || typeof domain !== 'string') return res.status(400).json({ error: 'Domain required' });
    // Basic domain/IP validation
    if (!/^[a-zA-Z0-9._-]{1,253}$/.test(domain)) return res.status(400).json({ error: 'Invalid domain format' });

    const conn = getConnection(sessionId);
    const d = domain.toLowerCase().trim();

    if (method === 'L7') {
      await conn.execute(`/ip firewall layer7-protocol add name="block-${d}" regexp=".*${d}.*"`);
      await conn.execute(`/ip firewall filter add chain=forward layer7-protocol="block-${d}" action=drop comment="netforge-block-${d}"`);
    } else if (method === 'IP-list') {
      await conn.execute(`/ip firewall address-list add list="blocklist" address=${d} comment="netforge-block"`);
      // Ensure the blocking rule exists
      try {
        await conn.execute(`/ip firewall filter add chain=forward dst-address-list="blocklist" action=drop comment="netforge-blocklist"`);
      } catch (e) { /* rule may already exist */ }
    } else {
      // Default: DNS-based block
      await conn.execute(`/ip dns static add name="${d}" address=0.0.0.0 comment="netforge-block-${d}"`);
    }

    res.json({ success: true, message: `Domain "${d}" blocked via ${method || 'DNS'}` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== BANDWIDTH — QUEUE MANAGEMENT ==========

app.post('/api/bandwidth/queue/add', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { name, target, down, up, priority, burst } = req.body;
    if (!name || !target) return res.status(400).json({ error: 'Name and target required' });
    if (!/^[a-zA-Z0-9._\-/ ]{1,64}$/.test(name)) return res.status(400).json({ error: 'Invalid queue name' });

    const prioMap = { high: 3, normal: 5, low: 7 };
    const prioNum = prioMap[priority] || 5;
    const maxLimit = `${down || '10M'}/${up || '10M'}`;

    let cmd = `/queue simple add name="${name}" target=${target} max-limit=${maxLimit} priority=${prioNum}`;
    if (burst) cmd += ' burst-time=8/8 burst-threshold=6M/6M burst-limit=20M/20M';

    await getConnection(sessionId).execute(cmd);
    res.json({ success: true, message: `Queue "${name}" created` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bandwidth/queue/remove', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Queue name required' });

    await getConnection(sessionId).execute(`/queue simple remove [find name="${name}"]`);
    res.json({ success: true, message: `Queue "${name}" removed` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== VPN — WIREGUARD PEER ==========

app.post('/api/vpn/peer/add', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { name, allowedIps, interfaceName } = req.body;
    if (!name) return res.status(400).json({ error: 'Peer name required' });

    const conn = getConnection(sessionId);

    // Find the WireGuard interface
    const wgIfaces = parseRouterOSOutput(await conn.execute('/interface wireguard print'));
    if (wgIfaces.length === 0) return res.status(404).json({ error: 'No WireGuard interface found. Configure WireGuard first.' });

    const wgIface = interfaceName || wgIfaces[0].name;
    const ips = allowedIps || '10.0.0.2/32';

    await conn.execute(`/interface wireguard peers add interface=${wgIface} allowed-address=${ips} comment="${name}"`);
    res.json({ success: true, message: `WireGuard peer "${name}" added to ${wgIface}` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== BACKUP — CREATE ==========

app.post('/api/backup/create', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);
    const date = new Date().toISOString().replace(/[T:]/g, '-').substring(0, 16);
    const name = `netforge-${date}`;

    // Save binary backup
    await conn.execute(`/system backup save name="${name}"`);
    res.json({ success: true, message: `Backup saved as ${name}.backup` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== DHCP — MAKE LEASE STATIC (RESERVE IP) ==========

app.post('/api/dhcp/reserve', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { mac, ip } = req.body;
    if (!mac) return res.status(400).json({ error: 'MAC address required' });

    const conn = getConnection(sessionId);

    // Find the lease by MAC and make it static
    const leases = parseRouterOSOutput(await conn.execute('/ip dhcp-server lease print'));
    const lease = leases.find(l => l.mac_address === mac);
    if (!lease) return res.status(404).json({ error: 'Lease not found for this MAC address' });

    await conn.execute(`/ip dhcp-server lease make-static numbers=${lease.numbers}`);

    // Optionally set a specific IP if provided
    if (ip) {
      await conn.execute(`/ip dhcp-server lease set [find mac-address="${mac}"] address=${ip}`);
    }

    res.json({ success: true, message: `IP reservation created for ${mac}` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== WAN — APPLY LOAD BALANCE ==========

app.post('/api/wan/apply-lb', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { wans, method, healthCheck } = req.body;
    if (!Array.isArray(wans) || wans.length < 1) return res.status(400).json({ error: 'At least one WAN required' });

    const conn = getConnection(sessionId);
    const cmds = [];

    if (method === 'failover') {
      // Failover: set distances on default routes
      for (let i = 0; i < wans.length; i++) {
        const wan = wans[i];
        cmds.push(`/ip route set [find gateway="${wan.gateway || wan.name}"] distance=${i + 1} comment="netforge-lb"`);
      }
    } else if (method === 'nth') {
      // NTH round-robin via mangle
      for (let i = 0; i < wans.length; i++) {
        const wan = wans[i];
        cmds.push(`/ip firewall mangle add chain=prerouting connection-state=new nth=${wans.length},1,${i} action=mark-connection new-connection-mark=wan${i+1}-conn passthrough=yes comment="netforge-lb"`);
        cmds.push(`/ip firewall mangle add chain=prerouting connection-mark=wan${i+1}-conn action=mark-routing new-routing-mark=wan${i+1} passthrough=yes comment="netforge-lb"`);
        if (wan.gateway) cmds.push(`/ip route add dst-address=0.0.0.0/0 gateway=${wan.gateway} routing-table=wan${i+1} comment="netforge-lb"`);
      }
    } else {
      // PCC (default) — per-connection classifier
      for (let i = 0; i < wans.length; i++) {
        const wan = wans[i];
        cmds.push(`/ip firewall mangle add chain=prerouting connection-state=new per-connection-classifier=src-address:${wans.length}/${i} action=mark-connection new-connection-mark=wan${i+1}-conn passthrough=yes comment="netforge-lb"`);
        cmds.push(`/ip firewall mangle add chain=prerouting connection-mark=wan${i+1}-conn action=mark-routing new-routing-mark=wan${i+1} passthrough=yes comment="netforge-lb"`);
        if (wan.gateway) cmds.push(`/ip route add dst-address=0.0.0.0/0 gateway=${wan.gateway} routing-table=wan${i+1} comment="netforge-lb"`);
      }
    }

    if (healthCheck) {
      for (let i = 0; i < wans.length; i++) {
        const wan = wans[i];
        if (wan.ip || wan.name) {
          cmds.push(`/tool netwatch add host=1.1.1.1 interval=5s comment="netforge-lb-check-wan${i+1}"`);
        }
      }
    }

    for (const cmd of cmds) {
      try { await conn.execute(cmd); } catch (e) { /* continue on individual failures */ }
    }

    res.json({ success: true, message: `Load balance (${method}) applied for ${wans.length} WAN(s)`, commandsApplied: cmds.length });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== SCHEDULER / AUTOMATION ==========

app.get('/api/scheduler', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const conn = getConnection(sessionId);
    const out = await conn.execute('/system scheduler print');
    const entries = parseRouterOSOutput(out);
    res.json(entries.map(e => ({
      id: e.numbers || '',
      name: e.name || '',
      startDate: e.start_date || '',
      startTime: e.start_time || '',
      interval: e.interval || '00:00:00',
      onEvent: e.on_event || '',
      policy: e.policy || '',
      runCount: parseInt(e.run_count) || 0,
      disabled: e.disabled === 'true',
      comment: e.comment || '',
      nextRun: e.next_run || '',
    })));
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scheduler/add', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { name, onEvent, startTime = '00:00:00', interval = '1d', comment, disabled = false } = req.body;
    if (!name || !onEvent) return res.status(400).json({ error: 'name and onEvent required' });
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(name)) return res.status(400).json({ error: 'Invalid scheduler name' });
    const conn = getConnection(sessionId);
    let cmd = `/system scheduler add name="${name}" on-event="${onEvent.replace(/"/g, '\\"')}" start-time=${startTime} interval=${interval} policy="read,write,policy,test"`;
    if (comment) cmd += ` comment="${comment}"`;
    if (disabled) cmd += ' disabled=yes';
    const out = await conn.execute(cmd);
    if (rosError(out)) return res.status(500).json({ error: out.trim().split('\n')[0] });
    res.json({ success: true, message: `Scheduler task "${name}" created` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scheduler/remove', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Scheduler name required' });
    const conn = getConnection(sessionId);
    const out = await conn.execute(`/system scheduler remove [find name="${name}"]`);
    if (rosError(out)) return res.status(500).json({ error: out.trim().split('\n')[0] });
    res.json({ success: true, message: `Scheduler task "${name}" removed` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scheduler/toggle', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { name, disabled } = req.body;
    if (!name) return res.status(400).json({ error: 'Scheduler name required' });
    const conn = getConnection(sessionId);
    const out = await conn.execute(`/system scheduler set [find name="${name}"] disabled=${disabled ? 'yes' : 'no'}`);
    if (rosError(out)) return res.status(500).json({ error: out.trim().split('\n')[0] });
    res.json({ success: true, message: `Task "${name}" ${disabled ? 'disabled' : 'enabled'}` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Deploy a pre-built automation recipe — creates script + scheduler entry
app.post('/api/automation/deploy-recipe', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { recipeId } = req.body;
    if (!recipeId) return res.status(400).json({ error: 'recipeId required' });

    const conn = getConnection(sessionId);
    const steps = [];

    if (recipeId === 'daily-backup') {
      const scriptSrc = `/system backup save name=("auto-backup-" . [/system clock get date]);`;
      await conn.execute(`/system script remove [find name="nf-daily-backup"]`).catch(() => {});
      const sOut = await conn.execute(`/system script add name="nf-daily-backup" policy="read,write,policy,test" source="${scriptSrc}"`);
      if (!rosError(sOut)) steps.push('Script nf-daily-backup created');
      await conn.execute(`/system scheduler remove [find name="nf-daily-backup"]`).catch(() => {});
      const schOut = await conn.execute(`/system scheduler add name="nf-daily-backup" on-event="nf-daily-backup" start-time=02:00:00 interval=1d policy="read,write,policy,test" comment="NetForge: daily backup"`);
      if (!rosError(schOut)) steps.push('Scheduler: runs daily at 02:00');

    } else if (recipeId === 'wan-health-check') {
      // Netwatch: restart PPPoE/LTE on failure
      const ifaces = parseRouterOSOutput(await conn.execute('/interface print'));
      const wanIface = ifaces.find(i => {
        const t = (i.type || '').toLowerCase(); const n = (i.name || '').toLowerCase();
        return t === 'pppoe-out' || t === 'lte' || n.includes('wan') || n.includes('pppoe');
      });
      const target = '1.1.1.1';
      const downScript = wanIface
        ? `/interface disable "${wanIface.name}";\n:delay 2;\n/interface enable "${wanIface.name}";\n/log info "NetForge: restarted ${wanIface.name} on WAN failure";`
        : `/log warning "NetForge: WAN health check failed - no auto-restart (no PPPoE iface found)";`;
      await conn.execute(`/system script remove [find name="nf-wan-down"]`).catch(() => {});
      await conn.execute(`/system script add name="nf-wan-down" policy="read,write,policy,test" source="${downScript}"`);
      await conn.execute(`/tool netwatch remove [find comment="netforge-wan-health"]`).catch(() => {});
      const nwOut = await conn.execute(`/tool netwatch add host=${target} interval=10s up-script="" down-script="nf-wan-down" comment="netforge-wan-health"`);
      if (rosError(nwOut)) return res.status(500).json({ error: nwOut.trim().split('\n')[0] });
      steps.push(`Netwatch: pings ${target} every 10s`);
      steps.push(wanIface ? `On failure: restarts ${wanIface.name}` : 'On failure: logs warning');

    } else if (recipeId === 'log-rotation') {
      const scriptSrc = `/log info "NetForge: log rotation check";\n/system logging action set [find type=memory] memory-lines=300;`;
      await conn.execute(`/system script remove [find name="nf-log-rotation"]`).catch(() => {});
      await conn.execute(`/system script add name="nf-log-rotation" policy="read,write,policy,test" source="${scriptSrc}"`);
      await conn.execute(`/system scheduler remove [find name="nf-log-rotation"]`).catch(() => {});
      await conn.execute(`/system scheduler add name="nf-log-rotation" on-event="nf-log-rotation" start-time=03:00:00 interval=7d policy="read,write,policy,test" comment="NetForge: weekly log rotation"`);
      steps.push('Weekly log rotation at 03:00 Sunday');

    } else if (recipeId === 'block-office-hours') {
      // Block social media during office hours Mon-Fri 9am-5pm
      const domains = [...(BLOCK_SERVICE_DOMAINS.youtube || []), ...(BLOCK_SERVICE_DOMAINS.facebook || []), ...(BLOCK_SERVICE_DOMAINS.tiktok || [])];
      const blockScript = `/ip dns static remove [find comment="nf-office-block"];\n` +
        domains.map(d => `/ip dns static add name="${d}" address=0.0.0.0 match-subdomain=yes comment="nf-office-block";`).join('\n') +
        `\n/log info "NetForge: office-hours content block activated";`;
      const unblockScript = `/ip dns static remove [find comment="nf-office-block"];\n/ip dns cache flush;\n/log info "NetForge: office-hours content block deactivated";`;
      for (const n of ['nf-office-block', 'nf-office-unblock']) await conn.execute(`/system script remove [find name="${n}"]`).catch(() => {});
      await conn.execute(`/system script add name="nf-office-block" policy="read,write,policy,test" source="${blockScript}"`);
      await conn.execute(`/system script add name="nf-office-unblock" policy="read,write,policy,test" source="${unblockScript}"`);
      for (const n of ['nf-block-weekday', 'nf-unblock-weekday']) await conn.execute(`/system scheduler remove [find name="${n}"]`).catch(() => {});
      await conn.execute(`/system scheduler add name="nf-block-weekday" on-event="nf-office-block" start-time=09:00:00 interval=1d day-of-week=mon,tue,wed,thu,fri policy="read,write,policy,test" comment="NetForge: block at 9am weekdays"`);
      await conn.execute(`/system scheduler add name="nf-unblock-weekday" on-event="nf-office-unblock" start-time=17:00:00 interval=1d day-of-week=mon,tue,wed,thu,fri policy="read,write,policy,test" comment="NetForge: unblock at 5pm weekdays"`);
      steps.push(`Content block: ${domains.length} domains`);
      steps.push('Active: Mon-Fri 09:00 to 17:00');

    } else if (recipeId === 'interface-watchdog') {
      // Monitor all ethernet interfaces, restart if down for >30s
      const scriptSrc = `:foreach i in=[/interface find type=ether disabled=no] do={\n  :if ([/interface get $i running] = false) do={\n    /interface disable $i;\n    :delay 3;\n    /interface enable $i;\n    /log warning ("NetForge: restarted iface " . [/interface get $i name]);\n  };\n};`;
      await conn.execute(`/system script remove [find name="nf-iface-watchdog"]`).catch(() => {});
      await conn.execute(`/system script add name="nf-iface-watchdog" policy="read,write,policy,test" source="${scriptSrc}"`);
      await conn.execute(`/system scheduler remove [find name="nf-iface-watchdog"]`).catch(() => {});
      await conn.execute(`/system scheduler add name="nf-iface-watchdog" on-event="nf-iface-watchdog" start-time=startup interval=1m policy="read,write,policy,test" comment="NetForge: interface watchdog"`);
      steps.push('Checks all ethernet interfaces every 60s');
      steps.push('Auto-restarts any interface that is down');

    } else if (recipeId === 'bandwidth-alert') {
      // Alert when CPU > 85% or memory > 90%
      const scriptSrc = `:local cpu [/system resource get cpu-load];\n:local mem [/system resource get free-memory];\n:local totMem [/system resource get total-memory];\n:local memPct (100 - (($mem * 100) / $totMem));\n:if ($cpu > 85) do={ /log warning ("NetForge CPU alert: " . $cpu . "%"); };\n:if ($memPct > 90) do={ /log warning ("NetForge MEM alert: " . $memPct . "%"); };`;
      await conn.execute(`/system script remove [find name="nf-resource-alert"]`).catch(() => {});
      await conn.execute(`/system script add name="nf-resource-alert" policy="read" source="${scriptSrc}"`);
      await conn.execute(`/system scheduler remove [find name="nf-resource-alert"]`).catch(() => {});
      await conn.execute(`/system scheduler add name="nf-resource-alert" on-event="nf-resource-alert" start-time=startup interval=5m policy="read,write,policy,test" comment="NetForge: resource alert"`);
      steps.push('Checks CPU & memory every 5 minutes');
      steps.push('Logs warning when CPU > 85% or memory > 90%');

    } else {
      return res.status(400).json({ error: `Unknown recipe: ${recipeId}` });
    }

    res.json({ success: true, steps, message: `Recipe "${recipeId}" deployed (${steps.length} steps)` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/automation/remove-recipe', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { recipeId } = req.body;
    const conn = getConnection(sessionId);
    const prefixMap = {
      'daily-backup':        ['nf-daily-backup'],
      'wan-health-check':    ['nf-wan-down'],
      'log-rotation':        ['nf-log-rotation'],
      'block-office-hours':  ['nf-office-block', 'nf-office-unblock', 'nf-block-weekday', 'nf-unblock-weekday'],
      'interface-watchdog':  ['nf-iface-watchdog'],
      'bandwidth-alert':     ['nf-resource-alert'],
    };
    const names = prefixMap[recipeId] || [];
    for (const n of names) {
      await conn.execute(`/system scheduler remove [find name="${n}"]`).catch(() => {});
      await conn.execute(`/system script remove [find name="${n}"]`).catch(() => {});
    }
    await conn.execute(`/ip dns static remove [find comment="nf-office-block"]`).catch(() => {});
    await conn.execute(`/tool netwatch remove [find comment="netforge-wan-health"]`).catch(() => {});
    res.json({ success: true, message: `Recipe "${recipeId}" removed` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== NETWORK HEALTH & DIAGNOSTICS ==========

// In-memory ping history per session (max 60 samples per target)
const pingHistory = new Map();

app.post('/api/network/ping', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { host = '1.1.1.1', count = 5, size = 56 } = req.body;
    if (!/^[\w.\-:]+$/.test(host)) return res.status(400).json({ error: 'Invalid host' });
    const conn = getConnection(sessionId);
    const out = await conn.execute(`/tool ping address=${host} count=${Math.min(count, 10)} size=${size} once`);
    // Parse RouterOS ping output: extract avg/min/max
    const lines = out.split('\n').filter(l => l.trim());
    const stats = {};
    for (const line of lines) {
      const avgMatch = line.match(/avg-rtt=([.\d]+)ms/i) || line.match(/avg[=:]\s*([.\d]+)/i);
      if (avgMatch) stats.avg = parseFloat(avgMatch[1]);
      const minMatch = line.match(/min-rtt=([.\d]+)ms/i) || line.match(/min[=:]\s*([.\d]+)/i);
      if (minMatch) stats.min = parseFloat(minMatch[1]);
      const maxMatch = line.match(/max-rtt=([.\d]+)ms/i) || line.match(/max[=:]\s*([.\d]+)/i);
      if (maxMatch) stats.max = parseFloat(maxMatch[1]);
      const lossMatch = line.match(/packet-loss=(\d+)/i) || line.match(/(\d+)%.*loss/i);
      if (lossMatch) stats.loss = parseInt(lossMatch[1]);
      const sentMatch = line.match(/sent=(\d+)/i);
      if (sentMatch) stats.sent = parseInt(sentMatch[1]);
      const recvMatch = line.match(/received=(\d+)/i);
      if (recvMatch) stats.received = parseInt(recvMatch[1]);
    }
    stats.host = host;
    stats.raw = out.trim().split('\n').slice(-5).join('\n');

    // Store in history
    if (!pingHistory.has(sessionId)) pingHistory.set(sessionId, new Map());
    const sh = pingHistory.get(sessionId);
    if (!sh.has(host)) sh.set(host, []);
    const h = sh.get(host);
    h.push({ ts: Date.now(), avg: stats.avg || 0, loss: stats.loss || 0 });
    if (h.length > 60) h.shift();

    res.json({ ...stats, history: sh.get(host) });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/network/traceroute', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { host } = req.body;
    if (!host || !/^[\w.\-:]+$/.test(host)) return res.status(400).json({ error: 'Invalid host' });
    const conn = getConnection(sessionId);
    const out = await conn.execute(`/tool traceroute address=${host} max-hops=20 once`);
    const hops = [];
    for (const line of out.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+([\d.]+)\s+([.\d]+)ms/);
      if (m) hops.push({ hop: parseInt(m[1]), address: m[2], rtt: parseFloat(m[3]) });
    }
    res.json({ host, hops, raw: out.trim() });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/netwatch', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const conn = getConnection(sessionId);
    const out = await conn.execute('/tool netwatch print');
    const rows = parseRouterOSOutput(out);
    res.json(rows.map(r => ({
      id: r.numbers || '',
      host: r.host || '',
      interval: r.interval || '10s',
      status: r.status || 'unknown',
      sinceTime: r.since || '',
      disabled: r.disabled === 'true',
      comment: r.comment || '',
      upScript: r.up_script || '',
      downScript: r.down_script || '',
    })));
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/netwatch/add', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { host, interval = '10s', upScript = '', downScript = '', comment = '' } = req.body;
    if (!host || !/^[\w.\-:]+$/.test(host)) return res.status(400).json({ error: 'Invalid host' });
    const conn = getConnection(sessionId);
    let cmd = `/tool netwatch add host=${host} interval=${interval}`;
    if (upScript) cmd += ` up-script="${upScript.replace(/"/g, '\\"')}"`;
    if (downScript) cmd += ` down-script="${downScript.replace(/"/g, '\\"')}"`;
    if (comment) cmd += ` comment="${comment}"`;
    const out = await conn.execute(cmd);
    if (rosError(out)) return res.status(500).json({ error: out.trim().split('\n')[0] });
    res.json({ success: true, message: `Netwatch added for ${host}` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/netwatch/remove', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID required' });
    const conn = getConnection(sessionId);
    await conn.execute(`/tool netwatch remove numbers=${id}`);
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== PORT FORWARD WIZARD ==========

app.post('/api/nat/port-forward', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { externalPort, internalIp, internalPort, protocol = 'tcp', comment = '', wanInterface = '' } = req.body;
    if (!externalPort || !internalIp) return res.status(400).json({ error: 'externalPort and internalIp required' });

    const intPort = internalPort || externalPort;
    const conn = getConnection(sessionId);
    const label = comment || `port-forward-${externalPort}`;

    let cmd = `/ip firewall nat add chain=dstnat protocol=${protocol} dst-port=${externalPort} action=dst-nat to-addresses=${internalIp} to-ports=${intPort} comment="netforge-${label}"`;
    if (wanInterface) cmd += ` in-interface="${wanInterface}"`;

    const out = await conn.execute(cmd);
    if (rosError(out)) return res.status(500).json({ error: out.trim().split('\n')[0] });
    res.json({ success: true, message: `Port forward ${externalPort}→${internalIp}:${intPort} (${protocol}) created` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== SERVE STATIC FILES ==========

app.use(express.static(path.join(__dirname)));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'netforge-api-integrated.html'));
});

// ========== ERROR HANDLING ==========

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ========== WEBSOCKET SERVER ==========

const wsClients = new Map();
const lastDataCache = new Map();
const MAX_CACHE_SIZE = 1000;
let cacheSize = 0;

class WebSocketManager {
  constructor(wss) {
    this.wss = wss;
    this.subscriptions = new Map();
    this.startBroadcaster();
  }

  addClient(sessionId, ws) {
    if (!wsClients.has(sessionId)) wsClients.set(sessionId, new Set());
    wsClients.get(sessionId).add(ws);
    if (!this.subscriptions.has(sessionId)) this.subscriptions.set(sessionId, new Set());
  }

  removeClient(sessionId, ws) {
    const clients = wsClients.get(sessionId);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) {
        wsClients.delete(sessionId);
        this.subscriptions.delete(sessionId);
      }
    }
  }

  subscribe(sessionId, endpoint) {
    if (!this.subscriptions.has(sessionId)) this.subscriptions.set(sessionId, new Set());
    this.subscriptions.get(sessionId).add(endpoint);
  }

  async broadcast(sessionId, endpoint, data) {
    const clients = wsClients.get(sessionId);
    if (!clients || !data) return;

    const cacheKey = `${sessionId}:${endpoint}`;
    const currentStr = JSON.stringify(data);
    const cached = lastDataCache.get(cacheKey);

    if (cached && cached.str === currentStr) return; // no change

    lastDataCache.set(cacheKey, { str: currentStr });
    cacheSize++;
    if (cacheSize > MAX_CACHE_SIZE) {
      lastDataCache.delete(lastDataCache.keys().next().value);
      cacheSize--;
    }

    const message = JSON.stringify({ type: endpoint, timestamp: Date.now(), data });

    clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        const subs = this.subscriptions.get(sessionId);
        if (subs && subs.has(endpoint)) {
          ws.send(message, err => { if (err) console.error('WS send error:', err); });
        }
      }
    });
  }

  startBroadcaster() {
    setInterval(async () => {
      for (const [sessionId, conn] of connections.entries()) {
        if (!conn.isConnected) continue;

        // Map each WebSocket endpoint to the real data-fetcher
        const fetchers = [
          ['/api/system-stats',  () => fetchSystemStats(conn)],
          ['/api/interfaces',    () => fetchInterfaces(conn)],
          ['/api/wan-status',    () => fetchWanStatus(conn)],
          ['/api/firewall',      () => fetchFirewall(conn)],
          ['/api/bandwidth',     () => fetchBandwidth(conn)],
          ['/api/dhcp-clients',  () => fetchDhcpClients(conn)],
          ['/api/wireless',      () => fetchWireless(conn)],
          ['/api/vpn',           () => fetchVpn(conn)],
          ['/api/logs',          () => fetchLogs(conn)],
        ];

        for (const [endpoint, fetcher] of fetchers) {
          try {
            const data = await fetcher();
            if (data != null) await this.broadcast(sessionId, endpoint, data);
          } catch (err) {
            // Don't crash the broadcaster if one endpoint fails
          }
        }
      }
    }, 5000);
  }
}

let wsManager;

// ========== STARTUP ==========

const PORT = process.env.PORT || 4444;
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

wsManager = new WebSocketManager(wss);

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('sessionId');

  if (!sessionId || !sessions.has(sessionId)) {
    ws.close(4001, 'Invalid session');
    return;
  }

  wsManager.addClient(sessionId, ws);
  ws.isAlive = true;

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.action === 'subscribe') {
        wsManager.subscribe(sessionId, data.endpoint);
        ws.send(JSON.stringify({ type: 'subscribed', endpoint: data.endpoint }));
      }
    } catch (err) {
      console.error('WS message error:', err);
    }
  });

  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => { wsManager.removeClient(sessionId, ws); });
  ws.on('error', (err) => { console.error('WS error:', err.message); });
});

// Heartbeat: drop dead connections
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, () => {
  console.log(`NetForge API server running on http://localhost:${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws?sessionId=<sessionId>`);
  console.log(`All endpoints require x-session-id header`);
});
