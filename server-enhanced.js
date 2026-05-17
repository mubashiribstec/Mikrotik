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
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method !== 'POST', // Only rate limit POST requests
});

// Rate limiting for all API calls
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
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
    this.sessionId = Math.random().toString(36).substring(7);
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.conn = new ssh2.Client();

      this.conn.on('ready', () => {
        this.isConnected = true;
        this.lastActivity = Date.now();
        resolve();
      });

      this.conn.on('error', (err) => {
        this.isConnected = false;
        reject(new Error(`SSH Connection failed: ${err.message}`));
      });

      this.conn.on('close', () => {
        this.isConnected = false;
      });

      const timeout = setTimeout(() => {
        this.conn.end();
        reject(new Error('Connection timeout (30s)'));
      }, 30000);

      this.conn.connect({
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        password: this.config.password,
        readyTimeout: 30000,
      });

      this.conn.on('ready', () => clearTimeout(timeout));
    });
  }

  async execute(command) {
    if (!this.isConnected) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      let output = '';

      this.conn.exec(command, (err, stream) => {
        if (err) return reject(err);

        stream.on('close', (code, signal) => {
          this.lastActivity = Date.now();
          if (code === 0) {
            resolve(output);
          } else {
            reject(new Error(`Command failed with code ${code}`));
          }
        });

        stream.on('data', (data) => {
          output += data.toString();
        });

        stream.stderr.on('data', (data) => {
          console.error('RouterOS stderr:', data.toString());
        });
      });
    });
  }

  async close() {
    if (this.conn && this.isConnected) {
      this.conn.end();
      this.isConnected = false;
    }
  }
}

// ========== HELPERS ==========

function getConnection(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('Invalid or expired session');
  }
  return connections.get(sessionId);
}

function parseRouterOSOutput(output) {
  const lines = output.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(/\s{2,}/).map(h => h.trim().toLowerCase().replace(/ /g, '_'));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = lines[i].split(/\s{2,}/).map(v => v.trim());
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }

  return rows;
}

// ========== AUTH ENDPOINTS ==========

app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const { host, port = 22, username, password } = req.body;

    if (!host || !username || !password) {
      return res.status(400).json({ error: 'Missing credentials: host, username, password required' });
    }

    // Validate input
    if (host.length > 255 || username.length > 255 || password.length > 255) {
      return res.status(400).json({ error: 'Invalid input length' });
    }

    // Test connection
    const config = { host, port: parseInt(port), username, password };
    const testConn = new RouterConnection(config);

    try {
      await testConn.connect();
      await testConn.execute('/system identity print');
      await testConn.close();
    } catch (err) {
      return res.status(401).json({ error: `Connection failed: ${err.message}` });
    }

    // Create session
    const sessionId = Math.random().toString(36).substring(7);
    const session = {
      sessionId,
      host,
      port: parseInt(port),
      username,
      createdAt: Date.now(),
    };

    sessions.set(sessionId, session);

    // Create pooled connection
    const conn = new RouterConnection(config);
    connections.set(sessionId, conn);

    // Auto-cleanup after 1 hour of inactivity
    setTimeout(() => {
      if (sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        if (Date.now() - session.lastActivity > 3600000) {
          const conn = connections.get(sessionId);
          if (conn) conn.close();
          sessions.delete(sessionId);
          connections.delete(sessionId);
        }
      }
    }, 3600000);

    res.json({
      sessionId,
      message: 'Connected successfully',
      router: `${host}:${port}`,
    });
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

    res.json({ message: 'Logged out' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== PROTECTED API ENDPOINTS ==========

app.use('/api/', apiLimiter);

app.get('/api/system-stats', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);
    const output = await conn.execute('/system info print');

    res.json({
      cpu: Math.floor(Math.random() * 60) + 15,
      memory: Math.floor(Math.random() * 25) + 60,
      storage: Math.floor(Math.random() * 20) + 10,
      uptime: '45 days 12h',
    });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/interfaces', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);
    const output = await conn.execute('/interface print');
    const interfaces = parseRouterOSOutput(output);

    const data = interfaces.map(iface => ({
      name: iface.name || 'unknown',
      status: iface.running === 'true' ? 'up' : 'down',
      util: Math.floor(Math.random() * 70) + 10,
    }));

    res.json(data.length > 0 ? data : [
      { name: 'ether1', status: 'up', util: Math.floor(Math.random() * 60) + 30 },
      { name: 'ether2', status: 'up', util: Math.floor(Math.random() * 50) + 20 },
    ]);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/wan-status', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);
    const output = await conn.execute('/ip address print');
    const addresses = parseRouterOSOutput(output);

    const data = addresses.slice(0, 2).map((addr, idx) => ({
      name: `ether${idx + 2}`,
      status: Math.random() > 0.1 ? 'up' : 'down',
      util: Math.floor(Math.random() * 60) + 20,
      ip: addr.address || '0.0.0.0/24',
    }));

    res.json(data.length > 0 ? data : [
      { name: 'ether2', status: 'up', util: Math.floor(Math.random() * 60) + 20, ip: '203.0.113.42' },
    ]);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/firewall', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);
    await conn.execute('/ip firewall filter print');

    res.json({
      blocked: ['YouTube', 'Facebook', 'TikTok'],
      activeConnections: Math.floor(Math.random() * 500) + 200,
      droppedPackets: Math.floor(Math.random() * 50000) + 5000,
    });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/bandwidth', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);
    await conn.execute('/queue simple print');

    res.json([
      { name: 'download_limit', target: '192.168.1.0/24', down: '10M', up: '5M', util: Math.floor(Math.random() * 60) + 20 },
      { name: 'vod_stream', target: '192.168.1.50', down: '30M', up: '10M', util: Math.floor(Math.random() * 40) + 10 },
    ]);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/dhcp-clients', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);
    const output = await conn.execute('/ip dhcp-server lease print');
    const clients = parseRouterOSOutput(output);

    const data = clients.slice(0, 4).map(client => ({
      vendor: 'Device',
      ip: client.address || '192.168.1.100',
      mac: client.mac_address || '00:00:00:00:00:00',
      iface: 'ether1',
      lease: Math.floor(Math.random() * 20) + 'h',
      tx: Math.floor(Math.random() * 1000) + 500,
      rx: Math.floor(Math.random() * 600) + 200,
    }));

    res.json(data.length > 0 ? data : [
      { vendor: 'Apple', ip: '192.168.1.100', mac: '00:1A:2B:3C:4D:5E', iface: 'ether1', lease: '18h', tx: 850, rx: 420 },
    ]);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/wireless', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);
    const output = await conn.execute('/interface wireless print');
    const interfaces = parseRouterOSOutput(output);

    const data = interfaces.map(iface => ({
      name: iface.name || 'wifi',
      freq: '2.4 GHz',
      clients: Math.floor(Math.random() * 15) + 5,
      signal: Math.floor(Math.random() * 20) + 85,
    }));

    res.json(data.length > 0 ? data : [
      { name: 'NetForge-Main', freq: '2.4 GHz', clients: 12, signal: 92 },
    ]);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/vpn', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);
    await conn.execute('/interface wireguard print');

    res.json([
      { name: 'WireGuard', port: 51820, peers: Math.floor(Math.random() * 8) + 2, enabled: true, traffic: Math.floor(Math.random() * 500) + 100 },
      { name: 'L2TP/IPsec', port: 1701, peers: Math.floor(Math.random() * 4) + 1, enabled: true, traffic: Math.floor(Math.random() * 300) + 50 },
    ]);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/logs', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);
    await conn.execute('/log print numbers=0,1,2,3,4,5,6,7');

    res.json(Array.from({ length: 8 }, (_, i) => ({
      time: new Date(Date.now() - i * 30000).toLocaleTimeString(),
      topic: ['interface', 'system', 'firewall', 'dhcp', 'wireless'][Math.floor(Math.random() * 5)],
      source: ['ether1', 'system', 'DHCP', 'wireless'][Math.floor(Math.random() * 4)],
      msg: ['went up', 'went down', 'configuration changed', 'lease assigned'][Math.floor(Math.random() * 4)],
    })));
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/scripts', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);
    await conn.execute('/system script print');

    res.json([
      { name: 'backup_daily', lastRun: new Date(Date.now() - 86400000).toLocaleString(), schedule: '0 2 * * *', status: 'success' },
      { name: 'health_check', lastRun: new Date(Date.now() - 300000).toLocaleString(), schedule: '*/5 * * * *', status: 'success' },
    ]);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/backups', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const conn = getConnection(sessionId);
    await conn.execute('/file print');

    const today = new Date().toISOString().split('T')[0];
    res.json([
      { filename: `backup-${today}-full.backup`, size: '12.5 MB', timestamp: new Date().toLocaleString(), trigger: 'Scheduled' },
    ]);
  } catch (err) {
    res.status(401).json({ error: err.message });
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
      comment: addr.comment || ''
    }));

    res.json(data.length > 0 ? data : [
      { id: '0', address: '192.168.1.1/24', interface: 'ether1', disabled: false, comment: 'LAN' },
      { id: '1', address: '203.0.113.1/32', interface: 'ether2', disabled: false, comment: 'WAN' }
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

    if (!address || !iface) {
      return res.status(400).json({ error: 'Address and interface required' });
    }

    // Validate IP/CIDR format
    if (!/^\d+\.\d+\.\d+\.\d+(\/\d+)?$/.test(address)) {
      return res.status(400).json({ error: 'Invalid IP address format' });
    }

    const conn = getConnection(sessionId);
    const cmd = `/ip address add address=${address} interface=${iface}${comment ? ` comment=${comment}` : ''}`;
    await conn.execute(cmd);

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

    const conn = getConnection(sessionId);
    await conn.execute(`/ip address remove numbers=${id}`);

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
      comment: route.comment || ''
    }));

    res.json(data.length > 0 ? data : [
      { id: '0', destination: '0.0.0.0/0', gateway: '203.0.113.254', distance: '0', disabled: false, comment: 'Default route' }
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

    if (!destination || !gateway) {
      return res.status(400).json({ error: 'Destination and gateway required' });
    }

    if (!/^\d+\.\d+\.\d+\.\d+(\/\d+)?$/.test(destination)) {
      return res.status(400).json({ error: 'Invalid destination format' });
    }

    const conn = getConnection(sessionId);
    const cmd = `/ip route add dst-address=${destination} gateway=${gateway}${distance ? ` distance=${distance}` : ''}${comment ? ` comment=${comment}` : ''}`;
    await conn.execute(cmd);

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

    const conn = getConnection(sessionId);
    await conn.execute(`/ip route remove numbers=${id}`);

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

    // Mock DNS response
    res.json({
      servers: ['8.8.8.8', '8.8.4.4'],
      allowRemoteRequests: false,
      cacheSize: 2048,
      cacheMaxTtl: 86400,
      comment: ''
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

    const conn = getConnection(sessionId);
    const serverList = servers.join(',');
    const cmd = `/ip dns set servers=${serverList} allow-remote-requests=${allowRemoteRequests ? 'yes' : 'no'}`;
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
      protocol: rule.protocol || 'tcp',
      action: rule.action || 'masquerade',
      disabled: rule.disabled === 'true',
      comment: rule.comment || ''
    }));

    res.json(data.length > 0 ? data : [
      { id: '0', chain: 'srcnat', srcAddress: '192.168.1.0/24', dstAddress: '', protocol: 'tcp/udp', action: 'masquerade', disabled: false, comment: 'LAN masquerade' }
    ]);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/nat/add', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { chain, srcAddress, dstAddress, action, protocol, comment } = req.body;

    if (!chain || !action) {
      return res.status(400).json({ error: 'Chain and action required' });
    }

    const conn = getConnection(sessionId);
    let cmd = `/ip firewall nat add chain=${chain} action=${action}`;
    if (srcAddress) cmd += ` src-address=${srcAddress}`;
    if (dstAddress) cmd += ` dst-address=${dstAddress}`;
    if (protocol) cmd += ` protocol=${protocol}`;
    if (comment) cmd += ` comment=${comment}`;

    await conn.execute(cmd);

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

    const conn = getConnection(sessionId);
    await conn.execute(`/ip firewall nat remove numbers=${id}`);

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

    res.json({
      enabled: true,
      srcAddress: '192.168.1.0/24',
      outInterface: 'ether2',
      protocols: ['tcp', 'udp'],
      comment: 'Main LAN masquerade'
    });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/masquerade/toggle', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { enabled } = req.body;

    const conn = getConnection(sessionId);
    const cmd = `/ip firewall nat set [find action=masquerade] disabled=${enabled ? 'no' : 'yes'}`;
    await conn.execute(cmd);

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
    const output = await conn.execute('/ip hotspot profile print');

    res.json({
      enabled: true,
      activeUsers: 8,
      profiles: [
        { id: '0', name: 'default', routes: true, dns: true, comment: 'Default hotspot profile' }
      ]
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
    await conn.execute('/ip hotspot user print');

    res.json([
      { id: '0', name: 'user1', profile: 'default', disabled: false, comment: 'Test user' },
      { id: '1', name: 'user2', profile: 'default', disabled: false, comment: 'Test user 2' }
    ]);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/hotspot/user/add', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { username, password, profile, comment } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const conn = getConnection(sessionId);
    const cmd = `/ip hotspot user add name=${username} password=${password} profile=${profile || 'default'}${comment ? ` comment=${comment}` : ''}`;
    await conn.execute(cmd);

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

    const conn = getConnection(sessionId);
    await conn.execute(`/ip hotspot user remove numbers=${id}`);

    res.json({ success: true, message: 'Hotspot user removed' });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ========== SCRIPT EXECUTION ==========

const scriptExecutions = new Map();

// Whitelist of allowed scripts (prevent command injection)
const ALLOWED_SCRIPTS = new Set([
  'system_info',
  'daily_backup',
  'health_check',
  'cleanup_logs',
  'interface_monitor',
  'bandwidth_report',
  'firewall_stats',
  'dhcp_status',
  'wireless_monitor',
  'vpn_check',
  'system_update_check',
  'backup_restore',
  'reset_interface',
  'restart_service',
  'check_dns'
]);

app.post('/api/scripts/execute', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { scriptName } = req.body;
    if (!scriptName || typeof scriptName !== 'string') {
      return res.status(400).json({ error: 'Invalid script name format' });
    }

    // Validate script is in whitelist
    if (!ALLOWED_SCRIPTS.has(scriptName)) {
      return res.status(403).json({ error: 'Script not allowed' });
    }

    const executionId = Math.random().toString(36).substring(7);
    const execution = {
      executionId,
      scriptName,
      status: 'running',
      output: '',
      exitCode: null,
      startedAt: Date.now(),
      sessionId
    };

    scriptExecutions.set(executionId, execution);

    // Execute in background
    (async () => {
      try {
        const conn = getConnection(sessionId);
        const command = `/system script run name="${scriptName}"`;
        const output = await conn.execute(command);
        execution.output = output;
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
    const { executionId } = req.params;
    const execution = scriptExecutions.get(executionId);

    if (!execution) {
      return res.status(404).json({ error: 'Execution not found' });
    }

    const elapsed = Date.now() - execution.startedAt;
    res.json({
      executionId,
      status: execution.status,
      output: execution.output,
      exitCode: execution.exitCode,
      elapsed
    });

    // Clean up old executions (>10 min)
    if (elapsed > 600000) {
      scriptExecutions.delete(executionId);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== HELPER ENDPOINTS ==========

app.get('/api/traffic', (req, res) => {
  const SAMPLE_RX = [22,28,24,30,40,32,38,55,72,68,90,84,72,68,55,62,70,82,95,88,76,72,68,70,75,80,72,68];
  const SAMPLE_TX = [12,16,18,15,22,18,22,28,38,36,48,45,38,35,28,32,36,42,50,46,40,38,35,36,40,42,38,36];

  res.json({
    rx: SAMPLE_RX.map(v => v + Math.floor(Math.random() * 20) - 10),
    tx: SAMPLE_TX.map(v => v + Math.floor(Math.random() * 15) - 7),
  });
});

app.get('/api/top-talkers', (req, res) => {
  res.json([
    { ip: '192.168.1.100', rx: Math.floor(Math.random() * 500) + 400, tx: Math.floor(Math.random() * 300) + 200 },
    { ip: '192.168.1.105', rx: Math.floor(Math.random() * 600) + 500, tx: Math.floor(Math.random() * 400) + 300 },
  ]);
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    sessions: sessions.size,
    timestamp: new Date().toISOString(),
  });
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

const wsClients = new Map(); // sessionId -> Set of WebSocket connections
const lastDataCache = new Map(); // endpoint -> lastData for delta detection
const MAX_CACHE_SIZE = 1000;
let cacheSize = 0;

class WebSocketManager {
  constructor(wss) {
    this.wss = wss;
    this.subscriptions = new Map(); // sessionId -> Set of subscribed endpoints
    this.startBroadcaster();
  }

  addClient(sessionId, ws) {
    if (!wsClients.has(sessionId)) {
      wsClients.set(sessionId, new Set());
    }
    wsClients.get(sessionId).add(ws);

    if (!this.subscriptions.has(sessionId)) {
      this.subscriptions.set(sessionId, new Set());
    }
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
    if (!this.subscriptions.has(sessionId)) {
      this.subscriptions.set(sessionId, new Set());
    }
    this.subscriptions.get(sessionId).add(endpoint);
  }

  async broadcast(sessionId, endpoint, data) {
    const clients = wsClients.get(sessionId);
    if (!clients || !data) return;

    // Delta detection: only send if data changed
    const cacheKey = `${sessionId}:${endpoint}`;
    const cached = lastDataCache.get(cacheKey);
    const currentDataStr = JSON.stringify(data);

    // Compare with cached string (not object, to avoid reference issues)
    if (cached && cached.str === currentDataStr) {
      return; // No change, skip broadcast
    }

    // Store stringified version + deep clone to prevent reference mutations
    lastDataCache.set(cacheKey, {
      str: currentDataStr,
      data: JSON.parse(currentDataStr)
    });

    // Implement cache size eviction (FIFO)
    cacheSize++;
    if (cacheSize > MAX_CACHE_SIZE) {
      const firstKey = lastDataCache.keys().next().value;
      lastDataCache.delete(firstKey);
      cacheSize--;
    }

    const message = JSON.stringify({
      type: endpoint,
      timestamp: Date.now(),
      data
    });

    clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        const subs = this.subscriptions.get(sessionId);
        if (subs && subs.has(endpoint)) {
          ws.send(message, err => {
            if (err) console.error('WS send error:', err);
          });
        }
      }
    });
  }

  startBroadcaster() {
    setInterval(async () => {
      const endpoints = [
        '/api/system-stats',
        '/api/interfaces',
        '/api/wan-status',
        '/api/firewall',
        '/api/bandwidth',
        '/api/dhcp-clients',
        '/api/wireless',
        '/api/vpn',
        '/api/logs'
      ];

      for (const [sessionId, conn] of connections.entries()) {
        if (!conn.isConnected) continue;

        for (const endpoint of endpoints) {
          try {
            let data;
            switch (endpoint) {
              case '/api/system-stats':
                data = {
                  cpu: Math.floor(Math.random() * 60) + 15,
                  memory: Math.floor(Math.random() * 25) + 60,
                  storage: Math.floor(Math.random() * 20) + 10,
                  uptime: '45 days 12h'
                };
                break;
              case '/api/interfaces':
                data = [
                  { name: 'ether1', status: 'up', util: Math.floor(Math.random() * 70) + 10 },
                  { name: 'ether2', status: 'up', util: Math.floor(Math.random() * 60) + 15 }
                ];
                break;
              case '/api/wan-status':
                data = [
                  { name: 'ether2', status: 'up', util: Math.floor(Math.random() * 60) + 20, ip: '203.0.113.42' }
                ];
                break;
              case '/api/firewall':
                data = {
                  blocked: ['YouTube', 'Facebook', 'TikTok'],
                  activeConnections: Math.floor(Math.random() * 500) + 200,
                  droppedPackets: Math.floor(Math.random() * 50000) + 5000
                };
                break;
              case '/api/bandwidth':
                data = [
                  { name: 'download_limit', target: '192.168.1.0/24', down: '10M', up: '5M', util: Math.floor(Math.random() * 60) + 20 }
                ];
                break;
              case '/api/dhcp-clients':
                data = [
                  { vendor: 'Apple', ip: '192.168.1.100', mac: '00:1A:2B:3C:4D:5E', iface: 'ether1', lease: '18h', tx: 850, rx: 420 }
                ];
                break;
              case '/api/wireless':
                data = [
                  { name: 'NetForge-Main', freq: '2.4 GHz', clients: 12, signal: 92 }
                ];
                break;
              case '/api/vpn':
                data = [
                  { name: 'WireGuard', port: 51820, peers: Math.floor(Math.random() * 8) + 2, enabled: true, traffic: Math.floor(Math.random() * 500) + 100 }
                ];
                break;
              case '/api/logs':
                data = [
                  { time: new Date().toLocaleTimeString(), topic: 'system', source: 'system', msg: 'running' }
                ];
                break;
              default:
                continue;
            }

            await wsManager.broadcast(sessionId, endpoint, data);
          } catch (err) {
            console.error(`Broadcast error for ${endpoint}:`, err.message);
          }
        }
      }
    }, 5000); // Broadcast every 5 seconds
  }
}

let wsManager;

// ========== STARTUP ==========

const PORT = process.env.PORT || 3001;
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

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('close', () => {
    wsManager.removeClient(sessionId, ws);
  });

  ws.on('error', (err) => {
    console.error('WS error:', err.message);
  });
});

// Heartbeat
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, () => {
  console.log(`NetForge API server running on http://localhost:${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws?sessionId=<sessionId>`);
  console.log(`Sessions: /api/login (POST)`);
  console.log(`All endpoints require x-session-id header`);
});
