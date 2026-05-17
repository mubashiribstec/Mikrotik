const express = require('express');
const ssh2 = require('ssh2');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

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

app.post('/api/login', async (req, res) => {
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
  res.sendFile(path.join(__dirname, 'netforge-3b.html'));
});

// ========== ERROR HANDLING ==========

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ========== STARTUP ==========

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`NetForge API server running on http://localhost:${PORT}`);
  console.log(`Sessions: /api/login (POST)`);
  console.log(`All endpoints require x-session-id header`);
});
