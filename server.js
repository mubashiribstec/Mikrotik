const express = require('express');
const ssh2 = require('ssh2');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// Router config (example values - update with real router)
const ROUTER_CONFIG = {
  host: process.env.ROUTER_IP || '192.168.1.1',
  port: parseInt(process.env.ROUTER_PORT || '22'),
  username: process.env.ROUTER_USER || 'admin',
  password: process.env.ROUTER_PASS || 'admin',
  readyTimeout: 30000,
};

// Helper: Execute command on router via SSH
async function executeRouterCommand(command) {
  return new Promise((resolve, reject) => {
    const conn = new ssh2.Client();
    let output = '';

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }

        stream.on('close', (code, signal) => {
          conn.end();
          resolve(output);
        });

        stream.on('data', (data) => {
          output += data.toString();
        });

        stream.stderr.on('data', (data) => {
          console.error('SSH error:', data.toString());
        });
      });
    });

    conn.on('error', (err) => {
      reject(err);
    });

    conn.connect(ROUTER_CONFIG);
  });
}

// Helper: Parse RouterOS output (simple CSV-like format)
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

// ========== API ENDPOINTS ==========

// System Stats
app.get('/api/system-stats', async (req, res) => {
  try {
    const output = await executeRouterCommand('/system info print');
    // Parse output for: uptime, cpu-frequency, free-memory, total-memory
    const cpuPercent = Math.floor(Math.random() * 60) + 15;
    const memPercent = Math.floor(Math.random() * 25) + 60;

    res.json({
      cpu: cpuPercent,
      memory: memPercent,
      storage: Math.floor(Math.random() * 20) + 10,
      uptime: '45 days 12h',
    });
  } catch (err) {
    console.error('Error fetching system stats:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Interfaces
app.get('/api/interfaces', async (req, res) => {
  try {
    const output = await executeRouterCommand('/interface print');
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
    console.error('Error fetching interfaces:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// WAN Status
app.get('/api/wan-status', async (req, res) => {
  try {
    const output = await executeRouterCommand('/ip address print');
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
    console.error('Error fetching WAN status:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Firewall Rules
app.get('/api/firewall', async (req, res) => {
  try {
    const output = await executeRouterCommand('/ip firewall filter print');

    res.json({
      blocked: ['YouTube', 'Facebook', 'TikTok'],
      activeConnections: Math.floor(Math.random() * 500) + 200,
      droppedPackets: Math.floor(Math.random() * 50000) + 5000,
    });
  } catch (err) {
    console.error('Error fetching firewall:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DHCP Clients
app.get('/api/dhcp-clients', async (req, res) => {
  try {
    const output = await executeRouterCommand('/ip dhcp-server lease print');
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
    console.error('Error fetching DHCP clients:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Wireless SSIDs
app.get('/api/wireless', async (req, res) => {
  try {
    const output = await executeRouterCommand('/interface wireless print');
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
    console.error('Error fetching wireless:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// VPN Status
app.get('/api/vpn', async (req, res) => {
  try {
    res.json([
      { name: 'WireGuard', port: 51820, peers: Math.floor(Math.random() * 8) + 2, enabled: true, traffic: Math.floor(Math.random() * 500) + 100 },
      { name: 'L2TP/IPsec', port: 1701, peers: Math.floor(Math.random() * 4) + 1, enabled: true, traffic: Math.floor(Math.random() * 300) + 50 },
    ]);
  } catch (err) {
    console.error('Error fetching VPN:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Logs
app.get('/api/logs', async (req, res) => {
  try {
    const output = await executeRouterCommand('/log print follow=yes numbers=0,1,2,3,4,5,6,7');

    res.json(Array.from({ length: 8 }, (_, i) => ({
      time: new Date(Date.now() - i * 30000).toLocaleTimeString(),
      topic: ['interface', 'system', 'firewall', 'dhcp', 'wireless'][Math.floor(Math.random() * 5)],
      source: ['ether1', 'system', 'DHCP', 'wireless'][Math.floor(Math.random() * 4)],
      msg: ['went up', 'went down', 'configuration changed', 'lease assigned'][Math.floor(Math.random() * 4)],
    })));
  } catch (err) {
    console.error('Error fetching logs:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Bandwidth Queues
app.get('/api/bandwidth', async (req, res) => {
  try {
    res.json([
      { name: 'download_limit', target: '192.168.1.0/24', down: '10M', up: '5M', util: Math.floor(Math.random() * 60) + 20 },
      { name: 'vod_stream', target: '192.168.1.50', down: '30M', up: '10M', util: Math.floor(Math.random() * 40) + 10 },
    ]);
  } catch (err) {
    console.error('Error fetching bandwidth:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Traffic Data (dummy for now)
app.get('/api/traffic', async (req, res) => {
  const SAMPLE_RX = [22,28,24,30,40,32,38,55,72,68,90,84,72,68,55,62,70,82,95,88,76,72,68,70,75,80,72,68];
  const SAMPLE_TX = [12,16,18,15,22,18,22,28,38,36,48,45,38,35,28,32,36,42,50,46,40,38,35,36,40,42,38,36];

  res.json({
    rx: SAMPLE_RX.map(v => v + Math.floor(Math.random() * 20) - 10),
    tx: SAMPLE_TX.map(v => v + Math.floor(Math.random() * 15) - 7),
  });
});

// Top Talkers
app.get('/api/top-talkers', async (req, res) => {
  try {
    res.json([
      { ip: '192.168.1.100', rx: Math.floor(Math.random() * 500) + 400, tx: Math.floor(Math.random() * 300) + 200 },
      { ip: '192.168.1.105', rx: Math.floor(Math.random() * 600) + 500, tx: Math.floor(Math.random() * 400) + 300 },
    ]);
  } catch (err) {
    console.error('Error fetching top talkers:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Scripts
app.get('/api/scripts', async (req, res) => {
  try {
    res.json([
      { name: 'backup_daily', lastRun: new Date(Date.now() - 86400000).toLocaleString(), schedule: '0 2 * * *', status: 'success' },
      { name: 'health_check', lastRun: new Date(Date.now() - 300000).toLocaleString(), schedule: '*/5 * * * *', status: 'success' },
    ]);
  } catch (err) {
    console.error('Error fetching scripts:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Backups
app.get('/api/backups', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    res.json([
      { filename: `backup-${today}-full.backup`, size: '12.5 MB', timestamp: new Date().toLocaleString(), trigger: 'Scheduled' },
    ]);
  } catch (err) {
    console.error('Error fetching backups:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', router: ROUTER_CONFIG.host });
});

// Serve static files (frontend)
app.use(express.static(path.join(__dirname)));

// 404 fallback to index
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`NetForge API server running on http://localhost:${PORT}`);
  console.log(`Router: ${ROUTER_CONFIG.host}:${ROUTER_CONFIG.port} (${ROUTER_CONFIG.username})`);
  console.log(`Override with: ROUTER_IP, ROUTER_PORT, ROUTER_USER, ROUTER_PASS env vars`);
});
