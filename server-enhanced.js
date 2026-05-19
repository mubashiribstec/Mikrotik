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

  return {
    cpu: Math.max(0, Math.min(100, cpuLoad)),
    memory: Math.max(0, Math.min(100, memoryPercent)),
    storage: Math.max(0, Math.min(100, storagePercent)),
    uptime: kv.uptime || 'unknown',
  };
}

async function fetchInterfaces(conn) {
  const output = await conn.execute('/interface print');
  const ifaces = parseRouterOSOutput(output);

  // Get per-interface byte counters for utilisation
  let statsRows = [];
  try {
    const statsOut = await conn.execute('/interface print stats');
    statsRows = parseRouterOSOutput(statsOut);
  } catch (e) { /* optional */ }

  return ifaces.map(iface => {
    const stats = statsRows.find(s => s.name === iface.name) || {};
    return {
      name: iface.name || 'unknown',
      status: iface.running === 'true' ? 'up' : 'down',
      util: 0, // rate requires two readings; set 0 here
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

  return addresses.map((addr, idx) => {
    const iface = ifaces.find(i => i.name === addr.interface);
    return {
      name: addr.interface || `ether${idx + 2}`,
      status: iface ? (iface.running === 'true' ? 'up' : 'down') : 'unknown',
      util: 0,
      ip: addr.address || '0.0.0.0/24',
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
    for (const line of statsOut.split('\n')) {
      if (line.includes('packets:')) {
        droppedPackets += parseInt(line.split('packets:')[1]?.trim()) || 0;
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

  const data = queues.map(q => ({
    name: q.name || 'queue',
    target: q.target || 'all',
    down: q.max_limit ? q.max_limit.split('/')[0] : 'unlimited',
    up: q.max_limit ? q.max_limit.split('/')[1] : 'unlimited',
    util: 0,
  }));

  return data.length > 0 ? data : [
    { name: 'default', target: 'all', down: 'unlimited', up: 'unlimited', util: 0 },
  ];
}

async function fetchDhcpClients(conn) {
  const output = await conn.execute('/ip dhcp-server lease print');
  const clients = parseRouterOSOutput(output);

  let arpData = [];
  try {
    arpData = parseRouterOSOutput(await conn.execute('/ip arp print'));
  } catch (e) { /* optional */ }

  return clients.slice(0, 10).map(client => {
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

    return {
      vendor,
      ip: client.address || '0.0.0.0',
      mac: client.mac_address || '00:00:00:00:00:00',
      iface: client.interface || 'bridge',
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
  const data = [];

  try {
    const wgIfaces = parseRouterOSOutput(await conn.execute('/interface wireguard print'));
    for (const wg of wgIfaces) {
      let peers = 0;
      try {
        const out = await conn.execute('/interface wireguard peers print count-only');
        peers = parseInt(out.trim()) || 0;
      } catch (e) { /* ok */ }
      data.push({
        name: wg.name || 'WireGuard',
        port: parseInt(wg.listen_port) || 51820,
        peers,
        enabled: wg.disabled !== 'true',
        traffic: 0,
      });
    }
  } catch (e) { /* WireGuard not configured */ }

  try {
    const l2tpOut = await conn.execute('/interface l2tp-server server print');
    const l2tp = parseRouterOSKeyValue(l2tpOut)[0] || {};
    if (l2tp.enabled === 'yes') {
      let peers = 0;
      try {
        const out = await conn.execute('/interface l2tp-server print count-only');
        peers = parseInt(out.trim()) || 0;
      } catch (e) { /* ok */ }
      data.push({ name: 'L2TP/IPsec', port: 1701, peers, enabled: true, traffic: 0 });
    }
  } catch (e) { /* L2TP not configured */ }

  if (data.length === 0) {
    data.push(
      { name: 'WireGuard', port: 51820, peers: 0, enabled: false, traffic: 0 },
      { name: 'L2TP/IPsec', port: 1701, peers: 0, enabled: false, traffic: 0 }
    );
  }

  return data;
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
    const { host, port = 22, username, password } = req.body || {};

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
      { vendor: 'Device', ip: '192.168.1.100', mac: '00:00:00:00:00:00', iface: 'ether1', lease: '24h', tx: 0, rx: 0 },
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

    const { servers, allowRemoteRequests } = req.body;
    if (!Array.isArray(servers) || servers.length === 0) {
      return res.status(400).json({ error: 'At least one DNS server required' });
    }

    const cmd = `/ip dns set servers=${servers.join(',')} allow-remote-requests=${allowRemoteRequests ? 'yes' : 'no'}`;
    await getConnection(sessionId).execute(cmd);
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

    const data = users.map(u => ({
      id: u.numbers || '',
      name: u.name || '',
      profile: u.profile || 'default',
      disabled: u.disabled === 'true',
      comment: u.comment || '',
    }));

    res.json(data);
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
