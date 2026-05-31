const express = require('express');
const ssh2 = require('ssh2');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const rateLimit = require('express-rate-limit');

// ========== NOTIFICATION CONFIG ==========

const NOTIF_CONFIG_PATH = path.join(__dirname, 'notif-config.json');
let notifConfigCache = null;

function loadNotifConfig() {
  if (notifConfigCache) return notifConfigCache;
  try {
    notifConfigCache = JSON.parse(fs.readFileSync(NOTIF_CONFIG_PATH, 'utf8'));
  } catch {
    notifConfigCache = {
      type: 'none',
      telegram: { token: '', chatId: '' },
      webhook: { url: '' },
      thresholds: { cpu: 90, memory: 95 },
      events: { cpuHigh: true, memHigh: true, wanDown: true },
    };
  }
  return notifConfigCache;
}

function saveNotifConfig(cfg) {
  notifConfigCache = cfg;
  try { fs.writeFileSync(NOTIF_CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request({
        hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 10000,
      }, res => { res.resume(); res.on('end', resolve); });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(body); req.end();
    } catch (e) { reject(e); }
  });
}

async function sendNotification(msg) {
  const cfg = loadNotifConfig();
  if (cfg.type === 'telegram' && cfg.telegram.token && cfg.telegram.chatId) {
    await httpPost(
      `https://api.telegram.org/bot${cfg.telegram.token}/sendMessage`,
      JSON.stringify({ chat_id: cfg.telegram.chatId, text: `🔔 NetForge Alert\n${msg}`, parse_mode: 'HTML' })
    );
  } else if (cfg.type === 'webhook' && cfg.webhook.url) {
    await httpPost(cfg.webhook.url, JSON.stringify({ text: msg, source: 'netforge', ts: Date.now() }));
  }
}

// Cooldown per alert type (global — avoids duplicate alerts across sessions)
const alertCooldowns = new Map(); // alertType → lastSentMs

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

// ========== ROUTEROS API CLIENT (port 8728 — alternative to SSH) ==========

// Protocol encoding
function _apiEncLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x4000) return Buffer.from([(n >> 8) | 0x80, n & 0xFF]);
  if (n < 0x200000) return Buffer.from([(n >> 16) | 0xC0, (n >> 8) & 0xFF, n & 0xFF]);
  return Buffer.from([(n >> 24) | 0xE0, (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF]);
}
function _apiDecLen(buf, pos) {
  const b = buf[pos];
  if ((b & 0x80) === 0x00) return { len: b, skip: 1 };
  if ((b & 0xC0) === 0x80) return { len: ((b & 0x3F) << 8) | buf[pos + 1], skip: 2 };
  if ((b & 0xE0) === 0xC0) return { len: ((b & 0x1F) << 16) | (buf[pos + 1] << 8) | buf[pos + 2], skip: 3 };
  return { len: ((b & 0x0F) << 24) | (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3], skip: 4 };
}
function _apiEncWord(w) { const wb = Buffer.from(w, 'utf-8'); return Buffer.concat([_apiEncLen(wb.length), wb]); }
function _apiEncSentence(words) { return Buffer.concat([...words.map(_apiEncWord), Buffer.from([0])]); }

// Parse raw TCP stream into complete RouterOS API sentences
function _apiParseBuf(buf) {
  const sentences = [];
  let pos = 0;
  outer: while (pos < buf.length) {
    const start = pos;
    const words = [];
    while (true) {
      if (pos >= buf.length) { pos = start; break outer; }
      const { len, skip } = _apiDecLen(buf, pos);
      pos += skip;
      if (len === 0) { sentences.push(words); break; }
      if (pos + len > buf.length) { pos = start; break outer; }
      words.push(buf.slice(pos, pos + len).toString('utf-8'));
      pos += len;
    }
  }
  return { sentences, remaining: buf.slice(pos) };
}

// Tokenize a RouterOS CLI command (handles quoted strings and [find ...] blocks)
function _cliTokenize(cmd) {
  const tokens = []; let i = 0; const s = cmd.trim();
  while (i < s.length) {
    while (i < s.length && s[i] === ' ') i++;
    if (i >= s.length) break;
    if (s[i] === '"') {
      let j = i + 1, str = '';
      while (j < s.length && s[j] !== '"') { if (s[j] === '\\') { str += s[j + 1]; j += 2; } else { str += s[j++]; } }
      tokens.push(str); i = j + 1;
    } else if (s[i] === '[') {
      let depth = 0, j = i;
      while (j < s.length) { if (s[j] === '[') depth++; else if (s[j] === ']') { if (--depth === 0) { j++; break; } } j++; }
      tokens.push(s.slice(i, j)); i = j;
    } else {
      // Handle key="value with spaces" inside unquoted token
      let j = i; let inQ = false;
      while (j < s.length) {
        if (s[j] === '"') inQ = !inQ;
        else if (s[j] === ' ' && !inQ) break;
        j++;
      }
      const tok = s.slice(i, j);
      // Strip surrounding quotes from value part: key="val" → key=val
      const eqPos = tok.indexOf('=');
      if (eqPos > 0) {
        let v = tok.slice(eqPos + 1);
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        tokens.push(tok.slice(0, eqPos + 1) + v);
      } else { tokens.push(tok); }
      i = j;
    }
  }
  return tokens;
}

const _API_ACTIONS = new Set(['print', 'add', 'remove', 'set', 'enable', 'disable', 'flush', 'reset', 'run', 'export', 'move', 'cancel', 'monitor', 'unset', 'getall']);

function _cliToApi(cmd) {
  const tokens = _cliTokenize(cmd.trim());
  if (!tokens.length) return null;
  const pathTokens = []; let action = ''; let i = 0;
  for (; i < tokens.length; i++) {
    const t = tokens[i];
    if (_API_ACTIONS.has(t.toLowerCase()) && !t.startsWith('/')) { action = t.toLowerCase(); i++; break; }
    if (!t.startsWith('[') && !t.includes('=')) pathTokens.push(t);
    else break;
  }
  const rest = tokens.slice(i);
  const cleanParts = pathTokens.join(' ').replace(/^\/+/, '').split(/[\/ ]+/).filter(Boolean);
  if (action) cleanParts.push(action);
  const apiPath = '/' + cleanParts.join('/');
  const findToken = rest.find(t => /^\[find/i.test(t));
  if (findToken) {
    const inner = findToken.replace(/^\[find\s*/i, '').replace(/\]$/, '');
    const findQ = {};
    _cliTokenize(inner).forEach(t => { const eq = t.indexOf('='); if (eq > 0) findQ[t.slice(0, eq)] = t.slice(eq + 1); });
    const afterFind = rest.filter(t => t !== findToken && t.includes('='));
    return { path: apiPath, params: [], findQuery: findQ, setAfterFind: afterFind };
  }
  const params = [];
  for (const t of rest) {
    if (/^\d+$/.test(t)) params.push(`=numbers=${t}`);
    else if (t.includes('=')) { const eq = t.indexOf('='); params.push(`=${t.slice(0, eq)}=${t.slice(eq + 1)}`); }
    else if (t === 'detail') params.push('=detail=');
  }
  return { path: apiPath, params, findQuery: null, setAfterFind: [] };
}

// Convert API rows → tabular text compatible with parseRouterOSOutput
function _apiRowsToTabular(rows) {
  if (!rows.length) return '';
  const allKV = rows.map(row => {
    const kv = {};
    for (const w of row) {
      if (!w.startsWith('=')) continue;
      const eq = w.indexOf('=', 1); if (eq === -1) continue;
      kv[w.slice(1, eq).toLowerCase().replace(/-/g, '_')] = w.slice(eq + 1);
    }
    return kv;
  });
  const keyList = []; const seen = new Set();
  for (const kv of allKV) for (const k of Object.keys(kv)) { if (!seen.has(k)) { seen.add(k); keyList.push(k); } }
  const widths = keyList.map(k => Math.min(Math.max(k.length, ...allKV.map(kv => (kv[k] || '').length)) + 2, 32));
  // Header: " #   " (5-char prefix) + padded column names
  let header = ' #   '; const colPos = {}; let pos = 5;
  for (let j = 0; j < keyList.length; j++) {
    colPos[keyList[j]] = pos;
    header += keyList[j].toUpperCase().replace(/_/g, '-').padEnd(widths[j]);
    pos += widths[j];
  }
  const lines = [header];
  for (let i = 0; i < allKV.length; i++) {
    const kv = allKV[i];
    const R = (kv.running === 'true' || kv.running === 'yes') ? 'R' : ' ';
    const X = (kv.disabled === 'true' || kv.disabled === 'yes') ? 'X' : ' ';
    let line = ` ${i} ${R}${X}`; // 5 chars for single-digit rows
    for (let j = 0; j < keyList.length; j++) {
      while (line.length < colPos[keyList[j]]) line += ' ';
      line += (kv[keyList[j]] || '').padEnd(widths[j]);
    }
    lines.push(line);
  }
  return lines.join('\n');
}

// Convert single API row → key:value text compatible with parseRouterOSKeyValue
function _apiRowToKeyValue(row) {
  return row.filter(w => w.startsWith('=')).map(w => {
    const eq = w.indexOf('=', 1); if (eq === -1) return '';
    return `                   ${w.slice(1, eq)}: ${w.slice(eq + 1)}`;
  }).join('\n');
}

// RouterOS API low-level client
class RouterOSAPIClient {
  constructor(config) {
    this.host = config.host; this.port = config.apiPort || 8728;
    this.username = config.username; this.password = config.password;
    this.socket = null; this.buf = Buffer.alloc(0);
    this.pending = new Map(); this.tagSeq = 1;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(this.port, this.host);
      let settled = false;
      const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
      const timer = setTimeout(() => { sock.destroy(); done(reject, new Error('API connection timeout (30s)')); }, 30000);
      sock.on('connect', async () => {
        clearTimeout(timer);
        this.socket = sock;
        try { await this._login(); done(resolve); }
        catch (e) { sock.destroy(); done(reject, e); }
      });
      sock.on('data', (data) => {
        this.buf = Buffer.concat([this.buf, data]);
        const { sentences, remaining } = _apiParseBuf(this.buf);
        this.buf = remaining;
        for (const s of sentences) this._handle(s);
      });
      sock.on('error', (e) => done(reject, new Error(`RouterOS API: ${e.message}`)));
      sock.on('close', () => {
        for (const req of this.pending.values()) req.reject(new Error('API connection closed'));
        this.pending.clear();
      });
    });
  }

  async _login() {
    // Try new-style plaintext login (RouterOS 6.43+ / all RouterOS 7)
    try { await this._send(['/login', `=name=${this.username}`, `=password=${this.password}`]); return; } catch {}
    // Old-style MD5 challenge-response login
    const rows = await this._send(['/login']);
    const challWord = rows.flat().find(w => w.startsWith('=ret='));
    if (!challWord) throw new Error('API login: no challenge received');
    const hash = crypto.createHash('md5')
      .update(Buffer.concat([Buffer.from([0]), Buffer.from(this.password, 'utf-8'), Buffer.from(challWord.slice(5), 'hex')]))
      .digest('hex');
    await this._send(['/login', `=name=${this.username}`, `=response=00${hash}`]);
  }

  _handle(words) {
    const type = words[0];
    const tagWord = words.find(w => w.startsWith('.tag=')); if (!tagWord) return;
    const req = this.pending.get(tagWord.slice(5)); if (!req) return;
    const data = words.slice(1).filter(w => !w.startsWith('.tag='));
    if (type === '!re') { req.rows.push(data); }
    else if (type === '!done') { clearTimeout(req.timer); req.resolve(req.rows); this.pending.delete(tagWord.slice(5)); }
    else if (type === '!trap' || type === '!fatal') {
      clearTimeout(req.timer);
      const msg = (data.find(w => w.startsWith('=message=')) || '=message=unknown error').slice(9);
      req.reject(new Error(msg)); this.pending.delete(tagWord.slice(5));
    }
  }

  async _send(words) {
    const tag = String(this.tagSeq++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(tag); reject(new Error(`API timeout: ${words[0]}`)); }, 25000);
      this.pending.set(tag, { rows: [], resolve, reject, timer });
      this.socket.write(_apiEncSentence([...words, `.tag=${tag}`]));
    });
  }

  async sendCommand(words) { return this._send(words); }
  close() { if (this.socket) { try { this.socket.destroy(); } catch {} this.socket = null; } }
}

// RouterAPI Connection — same interface as RouterConnection, uses port 8728
class RouterAPIConnection {
  constructor(config) {
    this.config = config; this.client = null;
    this.isConnected = false; this.lastActivity = Date.now();
    this._connectPromise = null;
  }

  async connect() {
    if (this._connectPromise) return this._connectPromise;
    this._connectPromise = (async () => {
      this.client = new RouterOSAPIClient(this.config);
      await this.client.connect();
      this.isConnected = true; this._connectPromise = null;
    })();
    return this._connectPromise;
  }

  async execute(cmd) {
    if (!this.isConnected) await this.connect();
    this.lastActivity = Date.now();
    try {
      const spec = _cliToApi(cmd.trim());
      if (!spec) return '';

      // Two-step: [find ...] → get .id → execute
      if (spec.findQuery && Object.keys(spec.findQuery).length > 0) {
        const printPath = spec.path.replace(/\/(set|remove|enable|disable|unset)$/, '/print');
        const qWords = [printPath, '=.proplist=.id'];
        for (const [k, v] of Object.entries(spec.findQuery)) qWords.push(`?=${k}=${v}`);
        const found = await this.client.sendCommand(qWords);
        if (!found.length) return '';
        for (const row of found) {
          const idW = row.find(w => w.startsWith('=.id=')); if (!idW) continue;
          await this.client.sendCommand([spec.path, `=.id=${idW.slice(5)}`, ...spec.setAfterFind.map(p => `=${p}`)]);
        }
        return '';
      }

      // Handle numbers=N (find by index, then execute by .id)
      const numParam = spec.params.find(p => p.startsWith('=numbers='));
      if (numParam && !spec.path.endsWith('/print')) {
        const idx = parseInt(numParam.slice(9));
        const printPath = spec.path.replace(/\/(set|remove|enable|disable|unset)$/, '/print');
        const found = await this.client.sendCommand([printPath, '=.proplist=.id']);
        if (idx >= found.length) return '';
        const idW = found[idx].find(w => w.startsWith('=.id=')); if (!idW) return '';
        const otherParams = spec.params.filter(p => !p.startsWith('=numbers='));
        await this.client.sendCommand([spec.path, `=.id=${idW.slice(5)}`, ...otherParams]);
        return '';
      }

      // Direct command
      const rows = await this.client.sendCommand([spec.path, ...spec.params]);
      if (!spec.path.endsWith('/print') && !spec.path.endsWith('/monitor')) return '';
      if (!rows.length) return '';
      // Single row → key-value format; multiple rows → tabular
      return rows.length === 1 ? _apiRowToKeyValue(rows[0]) : _apiRowsToTabular(rows);
    } catch (err) {
      return `failure: ${err.message}`;
    }
  }

  async close() {
    this.isConnected = false; this._connectPromise = null;
    if (this.client) { try { this.client.close(); } catch {} this.client = null; }
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

async function fetchSystemStats(conn, sessionId = null) {
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

  if (sessionId) {
    if (!statsHistory.has(sessionId)) statsHistory.set(sessionId, { cpu: new Array(28).fill(0), memory: new Array(28).fill(0) });
    const sh = statsHistory.get(sessionId);
    sh.cpu = [...sh.cpu.slice(1), Math.max(0, Math.min(100, cpuLoad))];
    sh.memory = [...sh.memory.slice(1), Math.max(0, Math.min(100, memoryPercent))];
  }

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
    cpuHistory: statsHistory.get(sessionId)?.cpu || [],
    memoryHistory: statsHistory.get(sessionId)?.memory || [],
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

  // Detect default-route gateways — maps interface name → gateway IP
  // NOTE: column parser converts DST-ADDRESS → dst_address (hyphens become underscores)
  const ifaceGateway = {};
  try {
    const routeOutput = await conn.execute('/ip route print where dst-address=0.0.0.0/0');
    const routes = parseRouterOSOutput(routeOutput);
    routes.forEach(r => {
      const gw = r.gateway || '';
      if (!gw) return;
      // If gateway is an interface name directly (PPPoE, etc.)
      if (ifaces.find(i => i.name === gw)) {
        ifaceGateway[gw] = gw;
        return;
      }
      // If gateway is an IP, find which interface owns a subnet containing it
      const matchedAddr = addresses.find(a => {
        const ip = (a.address || '').split('/')[0];
        const prefix = ip.split('.').slice(0, 3).join('.');
        return gw === ip || gw.startsWith(prefix + '.');
      });
      if (matchedAddr) ifaceGateway[matchedAddr.interface] = gw;
    });
  } catch {}

  // DHCP client gateways — most common case for residential ISPs
  try {
    const dhcpOut = await conn.execute('/ip dhcp-client print detail');
    const dhcpClients = parseRouterOSKeyValue(dhcpOut);
    dhcpClients.forEach(d => {
      const ifaceName = d.interface;
      const gw = d.gateway;
      if (ifaceName && gw && !ifaceGateway[ifaceName]) {
        ifaceGateway[ifaceName] = gw;
      }
    });
  } catch {}

  // For PPPoE/L2TP/PPTP, the interface name itself is the gateway in RouterOS
  ifaces.forEach(iface => {
    const type = (iface.type || '').toLowerCase();
    const name = (iface.name || '').toLowerCase();
    if (!ifaceGateway[iface.name] && (
      type === 'pppoe-out' || type === 'l2tp-out' || type === 'pptp-out' ||
      /^pppoe/.test(name) || /^l2tp/.test(name) || /^pptp/.test(name)
    )) {
      ifaceGateway[iface.name] = iface.name;
    }
  });

  // Classify each interface as WAN candidate
  const wanNames = new Set();
  ifaces.forEach(iface => {
    const type    = (iface.type    || '').toLowerCase();
    const comment = (iface.comment || '').toLowerCase();
    const name    = (iface.name    || '').toLowerCase();
    if (
      type === 'pppoe-out' || type === 'l2tp-out' || type === 'pptp-out' ||
      comment.includes('wan') || comment.includes('isp') ||
      name.includes('wan')    || name.includes('isp') ||
      /^lte\d/.test(name)     ||
      /^pppoe/.test(name)     || /^pptp/.test(name) || /^l2tp/.test(name) ||
      ifaceGateway[iface.name] !== undefined
    ) {
      wanNames.add(iface.name);
    }
  });

  // Build from interfaces (NOT addresses) so PPPoE/DHCP-only interfaces still appear
  const wanIfaces = ifaces.filter(i => wanNames.has(i.name));
  const source = wanIfaces.length > 0 ? wanIfaces : ifaces.filter(i => ifaceGateway[i.name]).slice(0, 4);

  return source.map((iface, idx) => {
    const addr = addresses.find(a => a.interface === iface.name);
    return {
      name:    iface.name || `WAN${idx + 1}`,
      status:  iface.running === 'true' ? 'up' : 'down',
      util:    0,
      ip:      addr?.address || '—',
      gateway: ifaceGateway[iface.name] || '',
      comment: iface.comment || addr?.comment || '',
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
  // Try RouterOS 7 wifi first, then legacy wireless
  let rows = [];
  try {
    const out = await conn.execute('/interface wifi print');
    rows = parseRouterOSOutput(out);
    if (rows.length === 0) throw new Error('no wifi interfaces');
  } catch {
    try {
      const out = await conn.execute('/interface wireless print');
      rows = parseRouterOSOutput(out);
    } catch { rows = []; }
  }
  return rows.map(w => ({
    name: w.name || '',
    ssid: w.ssid || w.configuration_ssid || '',
    channel: w.channel || w.frequency || '',
    band: w.band || w.configuration_band || '',
    clients: parseInt(w.registered_clients || w.clients || '0') || 0,
    running: w.running === 'true' || w.active === 'true',
    disabled: w.disabled === 'true',
    macAddress: w.mac_address || '',
    txPower: w.tx_power || '',
  }));
}

async function fetchVpn(conn) {
  const result = {
    wireguard: { enabled: false, interfaces: [], peers: [] },
    l2tp: { enabled: false, peers: 0 },
    pptp: { enabled: false, peers: 0 },
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

  // PPTP
  try {
    const pptpOut = await conn.execute('/interface pptp-server server print');
    const pptpRows = parseRouterOSKeyValue(pptpOut);
    const pptpCfg = pptpRows[0] || {};
    result.pptp = { enabled: pptpCfg.enabled === 'yes', peers: 0 };
    const pptpActive = parseRouterOSOutput(await conn.execute('/interface pptp-server print'));
    result.pptp.peers = pptpActive.length;
  } catch { result.pptp = { enabled: false, peers: 0 }; }

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

  // Try structured parse first (RouterOS returns columns including topics)
  const rows = parseRouterOSOutput(output);
  if (rows.length > 0 && (rows[0].topics || rows[0].topic || rows[0].time)) {
    for (const r of rows) {
      const topic = (r.topics || r.topic || 'system').split(',')[0].trim() || 'system';
      const source = r.topics?.includes('interface') ? 'interface' : (r.topics?.includes('dhcp') ? 'DHCP' : 'system');
      data.push({ time: r.time || '', topic, source, msg: (r.message || r.msg || '').substring(0, 100) });
    }
    return data.slice(-50).reverse();
  }

  // Fallback: line-by-line parse
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

// Rolling traffic history per session (180 data-points = 15 min at 5s intervals)
const trafficHistory = new Map();
// CPU/memory history per session (28 points for sparklines)
const statsHistory = new Map();
// Config snapshots per session (max 10)
const configSnapshots = new Map();

async function fetchTraffic(sessionId, conn) {
  const statsOut = await conn.execute('/interface print stats');
  const ifaces = parseRouterOSOutput(statsOut);

  let totalRx = 0, totalTx = 0;
  const ifaceBytes = {};
  for (const iface of ifaces) {
    const rx = parseInt(iface.rx_byte) || 0;
    const tx = parseInt(iface.tx_byte) || 0;
    totalRx += rx;
    totalTx += tx;
    ifaceBytes[iface.name] = { rx, tx };
  }

  const now = Date.now();

  if (!trafficHistory.has(sessionId)) {
    const perIface = {};
    for (const name of Object.keys(ifaceBytes)) {
      perIface[name] = { rx: new Array(180).fill(0), tx: new Array(180).fill(0), lastRx: ifaceBytes[name].rx, lastTx: ifaceBytes[name].tx };
    }
    trafficHistory.set(sessionId, {
      rx: new Array(180).fill(0),
      tx: new Array(180).fill(0),
      perIface,
      lastRx: totalRx,
      lastTx: totalTx,
      lastTime: now,
    });
    return { rx: new Array(180).fill(0), tx: new Array(180).fill(0), perIface: {} };
  }

  const hist = trafficHistory.get(sessionId);
  const elapsed = Math.max(1, (now - hist.lastTime) / 1000);

  const rxKbps = Math.max(0, Math.round(((totalRx - hist.lastRx) * 8) / elapsed / 1024));
  const txKbps = Math.max(0, Math.round(((totalTx - hist.lastTx) * 8) / elapsed / 1024));

  hist.rx = [...hist.rx.slice(1), rxKbps];
  hist.tx = [...hist.tx.slice(1), txKbps];
  hist.lastRx = totalRx;
  hist.lastTx = totalTx;
  hist.lastTime = now;

  // Per-interface deltas
  const perIfaceOut = {};
  for (const [name, bytes] of Object.entries(ifaceBytes)) {
    if (!hist.perIface[name]) {
      hist.perIface[name] = { rx: new Array(180).fill(0), tx: new Array(180).fill(0), lastRx: bytes.rx, lastTx: bytes.tx };
    }
    const pi = hist.perIface[name];
    const irx = Math.max(0, Math.round(((bytes.rx - pi.lastRx) * 8) / elapsed / 1024));
    const itx = Math.max(0, Math.round(((bytes.tx - pi.lastTx) * 8) / elapsed / 1024));
    pi.rx = [...pi.rx.slice(1), irx];
    pi.tx = [...pi.tx.slice(1), itx];
    pi.lastRx = bytes.rx;
    pi.lastTx = bytes.tx;
    perIfaceOut[name] = { rx: pi.rx, tx: pi.tx };
  }

  return { rx: hist.rx, tx: hist.tx, perIface: perIfaceOut };
}

// ========== AUTH ENDPOINTS ==========

app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const { host, port = 22, username, password, connectionType = 'ssh', apiPort = 8728 } = req.body || {};

    if (!host || !username || !password) {
      return res.status(400).json({ error: 'Missing credentials: host, username, password required' });
    }

    if (host.length > 255 || username.length > 255 || password.length > 255) {
      return res.status(400).json({ error: 'Invalid input length' });
    }

    const useApi = connectionType === 'api';
    const config = useApi
      ? { host, apiPort: parseInt(apiPort), username, password }
      : { host, port: parseInt(port), username, password };

    // Open the connection once and KEEP IT — don't open+close+open a second one
    const conn = useApi ? new RouterAPIConnection(config) : new RouterConnection(config);
    try {
      await conn.connect();
      await conn.execute('/system identity print'); // verify credentials work
    } catch (err) {
      try { conn.close(); } catch {}
      return res.status(401).json({ error: `Connection failed: ${err.message}` });
    }

    const sessionId = Math.random().toString(36).substring(7);
    const connPort = useApi ? parseInt(apiPort) : parseInt(port);
    sessions.set(sessionId, {
      sessionId, host, port: connPort, username, connectionType,
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
        statsHistory.delete(sessionId);
        configSnapshots.delete(sessionId);
      }
    }, 30 * 60 * 1000);

    res.json({ sessionId, message: 'Connected successfully', router: `${host}:${connPort}`, connectionType });
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
    statsHistory.delete(sessionId);
    configSnapshots.delete(sessionId);

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
    res.json(await fetchSystemStats(getConnection(sessionId), sessionId));
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
    res.json(data);
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
    res.json(data);
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
    // 'print detail' includes the source field; plain 'print' does not
    const output = await conn.execute('/system script print detail');
    const scripts = parseRouterOSOutput(output);

    const data = scripts.map(s => ({
      name: s.name || 'unknown',
      lastRun: s.last_started || 'never',
      runCount: parseInt(s.run_count) || 0,
      policy: s.policy || '',
      source: s.source || '',
      comment: s.comment || '',
    }));

    res.json(data.length > 0 ? data : []);
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
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

    res.json(data);
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
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
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
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
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
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

    res.json(data);
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
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
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
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
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
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
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
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
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
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

    const data = rules.map(r => ({
      id: r.numbers || '',
      chain: r.chain || '',
      action: r.action || '',
      protocol: r.protocol || '',
      srcAddress: r.src_address || '',
      dstAddress: r.dst_address || '',
      dstPort: r.dst_port || '',
      toAddresses: r.to_addresses || '',
      toPort: r.to_ports || '',
      inInterface: r.in_interface || '',
      disabled: r.disabled === 'true',
      comment: r.comment || '',
    }));

    res.json(data.length > 0 ? data : []);
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/nat/add', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { chain, action, protocol, srcAddress, dstAddress, dstPort, toAddresses, toPort, inInterface, comment } = req.body;
    if (!chain || !action) return res.status(400).json({ error: 'Chain and action required' });

    let cmd = `/ip firewall nat add chain=${chain} action=${action}`;
    if (protocol)    cmd += ` protocol=${protocol}`;
    if (srcAddress)  cmd += ` src-address=${srcAddress}`;
    if (dstAddress)  cmd += ` dst-address=${dstAddress}`;
    if (dstPort)     cmd += ` dst-port=${dstPort}`;
    if (toAddresses) cmd += ` to-addresses=${toAddresses}`;
    if (toPort)      cmd += ` to-ports=${toPort}`;
    if (inInterface) cmd += ` in-interface="${inInterface}"`;
    if (comment)     cmd += ` comment="${(comment).replace(/"/g,'')}"`;

    await getConnection(sessionId).execute(cmd);
    res.json({ success: true, message: 'NAT rule added' });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
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
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
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
    if (!/^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9._-]{0,251}[a-zA-Z0-9])?$/.test(name) && name !== '*') {
      return res.status(400).json({ error: 'Invalid domain name' });
    }

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
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
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
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
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
      const profOut = await conn.execute('/ip hotspot user profile print');
      profiles = parseRouterOSOutput(profOut).map(p => p.name || 'default');
    } catch (e) { /* optional */ }

    res.json({
      enabled: hotspots.length > 0 && hotspots[0].disabled !== 'true',
      activeUsers,
      profiles,
    });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
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
          id:       p.name || '',
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
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
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
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/hotspot/user/remove', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { id, type } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    const conn = getConnection(sessionId);
    if (type === 'pppoe') {
      // PPPoE users are /ppp secret entries
      await conn.execute(`/ppp secret remove [find name="${id}"]`);
    } else {
      await conn.execute(`/ip hotspot user remove numbers=${id}`);
    }
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== SCRIPT EXECUTION ==========

const scriptExecutions = new Map();

app.post('/api/scripts/execute', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const { scriptName } = req.body;
    if (!scriptName || typeof scriptName !== 'string' || !/^[a-zA-Z0-9._-]{1,64}$/.test(scriptName)) {
      return res.status(400).json({ error: 'Invalid script name format' });
    }
    // Verify the script actually exists on the router before running
    const conn = getConnection(sessionId);
    const existing = parseRouterOSOutput(await conn.execute('/system script print'));
    if (!existing.some(s => s.name === scriptName)) {
      return res.status(404).json({ error: `Script "${scriptName}" not found on router` });
    }

    const executionId = Math.random().toString(36).substring(7);
    const execution = {
      executionId, scriptName, status: 'running',
      output: '', exitCode: null, startedAt: Date.now(), sessionId,
    };
    scriptExecutions.set(executionId, execution);

    (async () => {
      try {
        execution.output = await conn.execute(`/system script run "${scriptName}"`);
        if (!execution.output) execution.output = '(script completed — no output)';
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
    const data = await fetchTraffic(sessionId, getConnection(sessionId));
    // Slice by requested range: 1m=12pts(60s), 5m=60pts, 15m=180pts(default)
    const range = req.query.range || '5m';
    const pts = range === '1m' ? 12 : range === '5m' ? 60 : 180;
    const slice = arr => arr.slice(-pts);
    const perIfaceSliced = {};
    for (const [name, pi] of Object.entries(data.perIface || {})) {
      perIfaceSliced[name] = { rx: slice(pi.rx), tx: slice(pi.tx) };
    }
    res.json({ rx: slice(data.rx), tx: slice(data.tx), perIface: perIfaceSliced });
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

    // Use connection counts per source IP as activity proxy, enriched with DHCP hostnames
    const [leasesOut, connOut] = await Promise.allSettled([
      conn.execute('/ip dhcp-server lease print'),
      conn.execute('/ip firewall connection print'),
    ]);
    const leases = leasesOut.status === 'fulfilled' ? parseRouterOSOutput(leasesOut.value) : [];
    const conns = connOut.status === 'fulfilled' ? parseRouterOSOutput(connOut.value) : [];

    // Build hostname map from DHCP
    const hostMap = {};
    for (const l of leases) { if (l.address) hostMap[l.address] = l.host_name || l.address; }

    // Count connections per source IP
    const connCount = {};
    for (const c of conns) {
      const ip = (c.src_address || '').split(':')[0];
      if (ip) connCount[ip] = (connCount[ip] || 0) + 1;
    }

    // Build result: active DHCP clients ranked by connection count
    const data = leases.slice(0, 10)
      .map(l => ({
        ip: l.address || '',
        mac: l.mac_address || '',
        hostname: l.host_name || l.address || '',
        connections: connCount[l.address] || 0,
        rx: 0, tx: 0,
      }))
      .sort((a, b) => b.connections - a.connections)
      .slice(0, 5);

    res.json(data.length > 0 ? data : [{ ip: '0.0.0.0', mac: '', hostname: '', connections: 0, rx: 0, tx: 0 }]);
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
    const out = await conn.execute(`/interface ethernet reset-mac-address [find name="${name}"]`);
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
    // Upsert: try add, fall back to set if name already exists
    const addOut = await conn.execute(`/system script add name="${name}" policy="${pol}" source="${source.replace(/"/g, '\\"')}"`);
    if (rosError(addOut)) {
      const setOut = await conn.execute(`/system script set [find name="${name}"] policy="${pol}" source="${source.replace(/"/g, '\\"')}"`);
      if (rosError(setOut)) return res.status(500).json({ error: setOut.trim().split('\n')[0] || 'Failed to save script' });
    }
    res.json({ success: true, message: `Script "${name}" saved` });
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
    if (rosError(out)) return res.status(500).json({ error: out.trim().split('\n')[0] });
    res.json({ success: true, message: `Script "${name}" removed` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== USERS — /user management (RouterOS top-level, NOT /ip user) ==========

app.get('/api/users', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const conn = getConnection(sessionId);
    const out = await conn.execute('/user print');
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
    const safeComment = (comment || '').replace(/["\\]/g, '');
    let cmd = `/user add name="${name}" password="${password}" group="${group}"`;
    if (safeComment) cmd += ` comment="${safeComment}"`;
    const out = await conn.execute(cmd);
    if (rosError(out)) return res.status(500).json({ error: out.trim().split('\n')[0] || 'Failed to add user' });
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
    const out = await conn.execute(`/user remove [find name="${name}"]`);
    if (rosError(out)) return res.status(500).json({ error: out.trim().split('\n')[0] });
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
    const out = await conn.execute(`/user set [find name="${name}"] password="${password}"`);
    if (rosError(out)) return res.status(500).json({ error: out.trim().split('\n')[0] });
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
// match-subdomain=yes (RouterOS 7.6+) covers all subdomains per entry.
const BLOCK_SERVICE_DOMAINS = {
  youtube:   ['youtube.com', 'youtu.be', 'googlevideo.com', 'ytimg.com', 'ggpht.com', 'youtube-nocookie.com'],
  facebook:  ['facebook.com', 'fbcdn.net', 'fb.com'],
  instagram: ['instagram.com', 'cdninstagram.com', 'i.instagram.com'],
  whatsapp:  ['whatsapp.com', 'whatsapp.net', 'wa.me'],
  messenger: ['messenger.com', 'fbmessenger.com', 'm.me'],
  discord:   ['discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.media'],
  twitter:   ['twitter.com', 'x.com', 't.co', 'twimg.com'],
  reddit:    ['reddit.com', 'redd.it', 'redditmedia.com', 'reddituploads.com', 'redditstatic.com'],
  twitch:    ['twitch.tv', 'twitchapps.com', 'jtvnw.net', 'twitchstatic.com'],
  tiktok:    ['tiktok.com', 'tiktokcdn.com', 'tiktokv.com', 'musical.ly', 'bytedance.com'],
  netflix:   ['netflix.com', 'nflxvideo.net', 'nflximg.net', 'nflxext.com', 'nflxso.net'],
  adult:     ['pornhub.com', 'xvideos.com', 'xnxx.com', 'xhamster.com', 'redtube.com', 'youporn.com'],
  torrents:  ['thepiratebay.org', '1337x.to', 'rarbg.to', 'nyaa.si', 'kickasstorrents.to', 'torrentgalaxy.to'],
  gambling:  ['bet365.com', 'pokerstars.com', '888casino.com', 'draftkings.com', 'fanduel.com', 'betway.com'],
  crypto:    ['coinhive.com', 'cryptoloot.pro', 'minero.cc', 'jsecoin.com'],
  snapchat:  ['snapchat.com', 'sc-static.net', 'snap.com', 'snapads.com'],
};

// Known stable IP CIDR ranges for mangle/IP blocking method.
// These supplement DNS blocking for clients that bypass DNS (hardcoded IPs, DoH, etc.)
const BLOCK_SERVICE_IPS = {
  youtube:   ['172.217.0.0/16', '142.250.0.0/15', '74.125.0.0/16', '64.233.160.0/19', '216.58.192.0/19'],
  facebook:  ['157.240.0.0/16', '179.60.192.0/22', '31.13.24.0/21', '129.134.0.0/17', '185.89.216.0/22'],
  instagram: ['157.240.0.0/16', '129.134.0.0/17'],
  whatsapp:  ['157.240.0.0/16', '179.60.192.0/22', '31.13.66.0/24'],
  messenger: ['157.240.0.0/16', '129.134.0.0/17'],
  discord:   ['162.159.128.0/17', '162.158.0.0/15', '104.16.0.0/13'],
  twitter:   ['104.244.42.0/23', '192.133.76.0/22', '199.16.156.0/22'],
  reddit:    ['151.101.0.0/16', '146.75.0.0/16'],
  twitch:    ['192.16.64.0/20', '192.16.80.0/21'],
  tiktok:    ['161.117.0.0/16', '43.152.0.0/14', '23.106.56.0/21'],
  netflix:   ['198.38.96.0/19', '198.45.48.0/20', '23.246.0.0/18', '37.77.184.0/21'],
  adult:     [],
  torrents:  [],
  gambling:  [],
  crypto:    [],
  snapchat:  ['52.22.0.0/16', '54.88.0.0/16', '35.168.0.0/13', '34.192.0.0/12'],
};

// Major CIDR aggregates per country for geo-blocking
const GEO_BLOCKS = {
  CN: { label: 'China',       ranges: ['1.0.1.0/24','1.0.2.0/23','1.0.8.0/21','1.0.32.0/19','36.0.0.0/11','39.0.0.0/9','42.0.0.0/9','49.0.0.0/10','58.0.0.0/11','101.0.0.0/9','106.0.0.0/8','110.0.0.0/9','112.0.0.0/10','114.0.0.0/10','116.0.0.0/10','117.128.0.0/10','118.0.0.0/10','119.0.0.0/9','120.0.0.0/9','121.0.0.0/10'] },
  RU: { label: 'Russia',      ranges: ['2.56.168.0/22','5.8.0.0/14','45.84.0.0/14','46.160.0.0/13','77.72.0.0/13','80.240.0.0/13','91.108.0.0/14','95.56.0.0/14','176.56.0.0/13','185.0.0.0/11','194.0.0.0/12','195.0.0.0/10','212.0.0.0/9','217.0.0.0/10'] },
  KP: { label: 'North Korea', ranges: ['175.45.176.0/22','210.52.109.0/24','77.94.35.0/24'] },
  IR: { label: 'Iran',        ranges: ['2.144.0.0/13','5.22.0.0/15','31.2.0.0/15','46.100.0.0/14','46.209.0.0/16','78.39.0.0/16','79.127.0.0/16','80.191.0.0/16','82.99.0.0/16','85.15.0.0/16','91.92.0.0/14','94.182.0.0/16','178.131.0.0/16','185.55.224.0/22'] },
  BY: { label: 'Belarus',     ranges: ['37.17.0.0/16','46.56.0.0/13','62.118.0.0/16','84.47.0.0/16','85.90.0.0/16','91.148.0.0/14','178.124.0.0/14','185.16.0.0/14','213.184.0.0/13'] },
  SY: { label: 'Syria',       ranges: ['31.9.0.0/17','46.53.0.0/17','78.111.0.0/16','84.11.0.0/16','109.224.0.0/12','176.65.0.0/16'] },
  MM: { label: 'Myanmar',     ranges: ['103.0.0.0/14','116.206.0.0/15','124.0.0.0/14','175.0.0.0/14','180.148.0.0/14'] },
  CU: { label: 'Cuba',        ranges: ['152.206.0.0/16','169.158.0.0/16','200.0.0.0/11'] },
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

const L7_SNAPCHAT_REGEXP = `^.+(snapchat\\.com|sc-static\\.net|snapfiles\\.com|snap\\.com).*$`;

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
      try { await conn.execute(`/ip firewall address-list remove [find list="${comment}"]`); } catch {}
    }

    const report = { method: blockMethod, steps: [] };

    // Helper: read back a chain and confirm our comment shows up in the output.
    // RouterOS `print detail` includes the comment column even when tabular hides it.
    const verifyRule = async (chainCmd) => {
      const out = await conn.execute(`${chainCmd} print detail`);
      return out.includes(`comment="${comment}"`) || out.includes(`comment=${comment}`);
    };

    if (block) {
      // ----------------------------------------------------------------
      // SHARED DNS FOUNDATION — all methods apply this first.
      // DNS static entries → 0.0.0.0 + NAT redirect + filter DROP rule.
      // The filter rule IS visible in the Firewall screen.
      // ----------------------------------------------------------------

      // 1. Enable DNS server on the router
      try { await conn.execute('/ip dns set allow-remote-requests=yes'); } catch {}

      // 2. DNS redirect — intercepts clients using 8.8.8.8 directly.
      //    Try with in-interface-list=LAN first; fall back without it.
      const natOut = await conn.execute('/ip firewall nat print');
      if (!natOut.includes('netforge-dns-redirect')) {
        let n1 = await conn.execute('/ip firewall nat add chain=dstnat protocol=udp dst-port=53 action=redirect to-ports=53 in-interface-list=LAN comment="netforge-dns-redirect"');
        if (rosError(n1)) n1 = await conn.execute('/ip firewall nat add chain=dstnat protocol=udp dst-port=53 action=redirect to-ports=53 comment="netforge-dns-redirect"');
        let n2 = await conn.execute('/ip firewall nat add chain=dstnat protocol=tcp dst-port=53 action=redirect to-ports=53 in-interface-list=LAN comment="netforge-dns-redirect"');
        if (rosError(n2)) n2 = await conn.execute('/ip firewall nat add chain=dstnat protocol=tcp dst-port=53 action=redirect to-ports=53 comment="netforge-dns-redirect"');
        report.steps.push({ ok: !rosError(n1), name: 'DNS NAT redirect (port 53 intercept)' });
      } else {
        report.steps.push({ ok: true, name: 'DNS NAT redirect already in place' });
      }

      // 3. DNS static entries → 0.0.0.0 (with match-subdomain=yes for RouterOS 7.6+)
      let dnsAdded = 0;
      const dnsErrors = [];
      for (const domain of domains) {
        const o1 = await conn.execute(`/ip dns static add name="${domain}" match-subdomain=yes address=0.0.0.0 type=A comment="${comment}"`);
        if (rosError(o1)) {
          const o2 = await conn.execute(`/ip dns static add name="${domain}" address=0.0.0.0 type=A comment="${comment}"`);
          if (rosError(o2)) {
            const o3 = await conn.execute(`/ip dns static set [find name="${domain}"] address=0.0.0.0 type=A comment="${comment}"`);
            if (rosError(o3)) dnsErrors.push(domain); else dnsAdded++;
          } else dnsAdded++;
        } else dnsAdded++;
      }
      report.steps.push({ ok: dnsAdded > 0, name: `DNS static entries: ${dnsAdded}/${domains.length} added`, errors: dnsErrors.slice(0, 3) });

      // 4. Filter forward DROP for the DNS sink (0.0.0.0).
      //    This creates a visible rule in /ip firewall filter.
      //    Appended to end of chain — no place-before needed in RouterOS 7.
      const fOut = await conn.execute(`/ip firewall filter add chain=forward dst-address=0.0.0.0 action=drop comment="${comment}"`);
      report.steps.push({ ok: !rosError(fOut), name: rosError(fOut) ? `Filter rule failed: ${fOut.trim().split('\n')[0]}` : 'Filter forward DROP rule added (visible in Firewall screen)' });

      // ----------------------------------------------------------------
      // METHOD-SPECIFIC ADDITIONS
      // ----------------------------------------------------------------

      if (blockMethod === 'layer7' || blockMethod === 'comprehensive') {
        // L7: Add L7 pattern + filter forward DROP for L7-matched traffic.
        // Inspects plaintext + TLS ClientHello SNI bytes for domain keywords.

        if (serviceId === 'torrents') {
          await blockTorrentsL7(conn);
          report.steps.push({ ok: true, name: 'Torrent L7+P2P rules installed' });
        } else {
          const pattern = [...new Set(domains.slice(0, 6).map(d => d.split('.')[0]).filter(Boolean))].join('|');
          const regexp = `(${pattern})`;

          const l7Out = await conn.execute(`/ip firewall layer7-protocol add name="${comment}" regexp="${regexp}" comment="${comment}"`);
          if (rosError(l7Out)) {
            await conn.execute(`/ip firewall layer7-protocol set [find name="${comment}"] regexp="${regexp}"`);
          }
          report.steps.push({ ok: true, name: `L7 protocol added: regexp=(${pattern})` });

          const lf = await conn.execute(`/ip firewall filter add chain=forward layer7-protocol="${comment}" action=drop comment="${comment}"`);
          report.steps.push({ ok: !rosError(lf), name: rosError(lf) ? `L7 filter failed: ${lf.trim().split('\n')[0]}` : 'L7 filter rule added (chain=forward)' });
        }
      }

      if (blockMethod === 'mangle' || blockMethod === 'comprehensive') {
        // MANGLE/IP: Add known IP CIDR ranges to address-list + filter rule.
        // RouterOS address-lists only accept IPs/CIDRs, not domain names.
        // Combined with DNS blocking above for comprehensive coverage.

        const ipRanges = BLOCK_SERVICE_IPS[serviceId] || [];
        let ipAdded = 0;
        for (const cidr of ipRanges) {
          const o = await conn.execute(`/ip firewall address-list add list="${comment}" address="${cidr}" comment="${comment}"`);
          if (!rosError(o)) ipAdded++;
        }

        if (ipAdded > 0) {
          const rfOut = await conn.execute(`/ip firewall filter add chain=forward dst-address-list="${comment}" action=drop comment="${comment}"`);
          report.steps.push({ ok: !rosError(rfOut), name: `IP ranges: ${ipAdded}/${ipRanges.length} CIDRs + address-list filter rule` });
        } else if (ipRanges.length === 0) {
          report.steps.push({ ok: true, name: 'No IP ranges for this service — DNS+L7 blocking active' });
        } else {
          report.steps.push({ ok: false, name: `IP ranges failed to add (${ipRanges.length} attempted)` });
        }
      }
      // 'dns' method: only the shared foundation above — no extra steps.

    } else {
      // UNBLOCK — remove all netforge rules for this service
      try { await conn.execute(`/ip dns static remove [find comment="${comment}"]`); } catch {}
      try { await conn.execute(`/ip firewall filter remove [find comment="${comment}"]`); } catch {}
      try { await conn.execute(`/ip firewall raw remove [find comment="${comment}"]`); } catch {}
      try { await conn.execute(`/ip firewall mangle remove [find comment="${comment}"]`); } catch {}
      try { await conn.execute(`/ip firewall layer7-protocol remove [find name="${comment}"]`); } catch {}
      try { await conn.execute(`/ip firewall address-list remove [find comment="${comment}"]`); } catch {}
      try { await conn.execute(`/ip firewall address-list remove [find list="${comment}-src"]`); } catch {}
      if (serviceId === 'torrents') await unblockTorrentsL7(conn);
      report.steps.push({ ok: true, name: 'All rules removed' });
    }

    // Always flush DNS cache so changes take effect immediately
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

    const { name, allowedIps, interfaceName, publicKey } = req.body;
    if (!name) return res.status(400).json({ error: 'Peer name required' });

    const conn = getConnection(sessionId);

    // Find the WireGuard interface
    const wgIfaces = parseRouterOSOutput(await conn.execute('/interface wireguard print'));
    if (wgIfaces.length === 0) return res.status(404).json({ error: 'No WireGuard interface found. Configure WireGuard first.' });

    const wgIface = interfaceName || wgIfaces[0].name;
    const ips = allowedIps || '10.0.0.2/32';

    let peerCmd = `/interface wireguard peers add interface=${wgIface} allowed-address=${ips} comment="${name}"`;
    if (publicKey && /^[A-Za-z0-9+/]{43}=$/.test(publicKey)) {
      peerCmd += ` public-key="${publicKey}"`;
    }
    await conn.execute(peerCmd);
    // Fetch the newly created peer's info including public-key
    const peers = parseRouterOSOutput(await conn.execute('/interface wireguard peers print'));
    const newPeer = peers.find(p => (p.comment || '') === name) || {};
    res.json({
      success: true,
      message: `WireGuard peer "${name}" added to ${wgIface}`,
      publicKey: newPeer.public_key || publicKey || '',
      allowedAddress: newPeer.allowed_address || ips,
    });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== VPN — CREATE WIREGUARD INTERFACE ==========

app.post('/api/vpn/wireguard/create', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { name = 'wireguard1', listenPort = 51820, mtu = 1420 } = req.body;
    const conn = getConnection(sessionId);
    const out = await conn.execute(`/interface wireguard add name="${name}" listen-port=${listenPort} mtu=${mtu}`);
    if (rosError(out)) return res.status(500).json({ error: out.trim().split('\n')[0] || 'Failed to create interface' });
    // Get the public key
    const ifaces = parseRouterOSOutput(await conn.execute('/interface wireguard print'));
    const iface = ifaces.find(i => i.name === name);
    res.json({ success: true, message: `WireGuard interface "${name}" created`, publicKey: iface?.public_key || '' });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== VPN — PPTP SERVER ==========

app.post('/api/vpn/pptp/toggle', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { enabled, localAddress = '10.0.0.1', remoteStart = '10.0.0.10', remoteEnd = '10.0.0.20' } = req.body;
    const conn = getConnection(sessionId);
    if (enabled) {
      // Create IP pool if needed
      const poolOut = await conn.execute(`/ip pool add name="pptp-pool" ranges=${remoteStart}-${remoteEnd}`);
      if (rosError(poolOut)) {
        await conn.execute(`/ip pool set [find name="pptp-pool"] ranges=${remoteStart}-${remoteEnd}`);
      }
      // Create PPP profile
      const profOut = await conn.execute(`/ppp profile add name="pptp-profile" local-address=${localAddress} remote-address=pptp-pool use-encryption=yes`);
      if (rosError(profOut)) {
        await conn.execute(`/ppp profile set [find name="pptp-profile"] local-address=${localAddress} remote-address=pptp-pool use-encryption=yes`);
      }
      // Enable PPTP server
      await conn.execute('/interface pptp-server server set enabled=yes default-profile=pptp-profile');
      res.json({ success: true, message: 'PPTP server enabled' });
    } else {
      await conn.execute('/interface pptp-server server set enabled=no');
      res.json({ success: true, message: 'PPTP server disabled' });
    }
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vpn/pptp/user/add', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { name, password, profile = 'pptp-profile' } = req.body;
    if (!name || !password) return res.status(400).json({ error: 'name and password required' });
    const conn = getConnection(sessionId);
    const out = await conn.execute(`/ppp secret add name="${name}" password="${password}" service=pptp profile=${profile}`);
    if (rosError(out)) return res.status(500).json({ error: out.trim().split('\n')[0] || 'Failed to add user' });
    res.json({ success: true, message: `PPTP user "${name}" added` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== VPN — L2TP SERVER ==========

app.post('/api/vpn/l2tp/toggle', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { enabled, ipsecSecret = 'vpnsecret', localAddress = '10.1.0.1', remoteStart = '10.1.0.10', remoteEnd = '10.1.0.20' } = req.body;
    const conn = getConnection(sessionId);
    if (enabled) {
      const poolOut = await conn.execute(`/ip pool add name="l2tp-pool" ranges=${remoteStart}-${remoteEnd}`);
      if (rosError(poolOut)) {
        await conn.execute(`/ip pool set [find name="l2tp-pool"] ranges=${remoteStart}-${remoteEnd}`);
      }
      const profOut = await conn.execute(`/ppp profile add name="l2tp-profile" local-address=${localAddress} remote-address=l2tp-pool use-encryption=yes`);
      if (rosError(profOut)) {
        await conn.execute(`/ppp profile set [find name="l2tp-profile"] local-address=${localAddress} remote-address=l2tp-pool use-encryption=yes`);
      }
      await conn.execute(`/interface l2tp-server server set enabled=yes default-profile=l2tp-profile use-ipsec=yes ipsec-secret="${ipsecSecret}"`);
      res.json({ success: true, message: 'L2TP/IPsec server enabled' });
    } else {
      await conn.execute('/interface l2tp-server server set enabled=no');
      res.json({ success: true, message: 'L2TP/IPsec server disabled' });
    }
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vpn/l2tp/user/add', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { name, password, profile = 'l2tp-profile' } = req.body;
    if (!name || !password) return res.status(400).json({ error: 'name and password required' });
    const conn = getConnection(sessionId);
    const out = await conn.execute(`/ppp secret add name="${name}" password="${password}" service=l2tp profile=${profile}`);
    if (rosError(out)) return res.status(500).json({ error: out.trim().split('\n')[0] || 'Failed to add user' });
    res.json({ success: true, message: `L2TP user "${name}" added` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vpn/ppp-secrets', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const conn = getConnection(sessionId);
    const rows = parseRouterOSOutput(await conn.execute('/ppp secret print'));
    res.json(rows.map(r => ({ name: r.name, service: r.service, profile: r.profile, comment: r.comment })));
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vpn/ppp-secret/remove', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const conn = getConnection(sessionId);
    await conn.execute(`/ppp secret remove [find name="${name}"]`);
    res.json({ success: true });
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
    if (!Array.isArray(wans) || wans.length < 2) {
      return res.status(400).json({ error: 'At least 2 WANs required for load balancing' });
    }

    // Validate gateways upfront — without them, route commands silently misbehave
    const missing = wans.filter(w => !w.gateway || w.gateway === '—' || w.gateway === '');
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Gateway not detected for: ${missing.map(w => w.name).join(', ')}. Each WAN needs a default route or DHCP client lease.`,
        missing: missing.map(w => w.name),
      });
    }

    const conn = getConnection(sessionId);

    // Clean up previous netforge-lb rules — apply is idempotent
    try { await conn.execute('/ip firewall mangle remove [find comment="netforge-lb"]'); } catch {}
    try { await conn.execute('/ip route remove [find comment="netforge-lb"]'); } catch {}
    try { await conn.execute('/tool netwatch remove [find comment="netforge-lb"]'); } catch {}

    const applied = [];
    const failed  = [];

    // RouterOS app-errors come back as resolved strings; detect them with rosError()
    const exec = async (cmd) => {
      const out = await conn.execute(cmd);
      if (rosError(out)) {
        failed.push({ cmd, error: out.trim().split('\n')[0] });
        return null;
      }
      applied.push(cmd);
      return out;
    };

    if (method === 'failover') {
      for (let i = 0; i < wans.length; i++) {
        const wan = wans[i];
        await exec(`/ip route add dst-address=0.0.0.0/0 gateway="${wan.gateway}" distance=${i + 1} check-gateway=ping comment="netforge-lb"`);
      }
    } else {
      // RouterOS 7+ requires routing tables to be declared first; v6 auto-creates
      // We try and ignore: if table already exists or command isn't recognized, no harm
      for (const wan of wans) {
        try { await conn.execute(`/routing table add name=to-${wan.name} fib`); } catch {}
      }

      // PCC or NTH — both use mangle mark-connection + mark-routing + route per WAN
      // Total bucket count respects per-WAN weight
      const S = wans.reduce((s, w) => s + (w.weight || 1), 0);
      let bucket = 0;

      for (const wan of wans) {
        const w = wan.weight || 1;
        for (let k = 0; k < w; k++) {
          if (method === 'nth') {
            // NTH: nth=<every>,<counter> — every=S, counter=bucket (1-based)
            await exec(`/ip firewall mangle add chain=prerouting connection-state=new nth=${S},${bucket + 1} action=mark-connection new-connection-mark=${wan.name}-conn comment="netforge-lb"`);
          } else {
            // PCC (default): both-addresses classifier
            await exec(`/ip firewall mangle add chain=prerouting connection-state=new per-connection-classifier=both-addresses:${S}/${bucket} action=mark-connection new-connection-mark=${wan.name}-conn comment="netforge-lb"`);
          }
          bucket++;
        }
        // Mark routing for this WAN's connections
        await exec(`/ip firewall mangle add chain=prerouting connection-mark=${wan.name}-conn action=mark-routing new-routing-mark=to-${wan.name} comment="netforge-lb"`);

        // Add route in this WAN's routing table — use server-detected gateway only
        await exec(`/ip route add gateway="${wan.gateway}" routing-mark=to-${wan.name} comment="netforge-lb"`);
      }
    }

    if (healthCheck) {
      await exec('/tool netwatch add host=1.1.1.1 interval=5s comment="netforge-lb"');
    }

    if (failed.length > 0 && applied.length === 0) {
      return res.status(500).json({
        error: `All ${failed.length} commands failed. First error: ${failed[0].error}`,
        applied: 0,
        failed,
      });
    }

    res.json({
      success: true,
      message: `${method.toUpperCase()} applied — ${applied.length} ok${failed.length ? `, ${failed.length} failed` : ''}`,
      commandsApplied: applied.length,
      failed: failed.length > 0 ? failed : undefined,
    });
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
      const nwOut = await conn.execute(`/tool netwatch add host=${target} interval=10s up-script="/system script run nf-wan-up" down-script="/system script run nf-wan-down" comment="netforge-wan-health"`);
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
    const out = await conn.execute(`/tool ping address=${host} count=${Math.min(count, 10)} size=${size}`);
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

    const extPort = parseInt(externalPort);
    const intPort = parseInt(internalPort || externalPort);
    if (isNaN(extPort) || extPort < 1 || extPort > 65535) return res.status(400).json({ error: 'External port must be 1–65535' });
    if (isNaN(intPort) || intPort < 1 || intPort > 65535) return res.status(400).json({ error: 'Internal port must be 1–65535' });
    const conn = getConnection(sessionId);
    const label = comment || `port-forward-${externalPort}`;

    let cmd = `/ip firewall nat add chain=dstnat protocol=${protocol} dst-port=${extPort} action=dst-nat to-addresses=${internalIp} to-ports=${intPort} comment="netforge-${label}"`;
    if (wanInterface) cmd += ` in-interface="${wanInterface}"`;

    const out = await conn.execute(cmd);
    if (rosError(out)) return res.status(500).json({ error: out.trim().split('\n')[0] });
    res.json({ success: true, message: `Port forward ${extPort}→${internalIp}:${intPort} (${protocol}) created` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== ACCESS CONTROL — RESTRICT ROUTER ACCESS ==========

// Ports the router exposes — used to build allow/drop rules on chain=input
const ACCESS_PORTS = [
  { port: 8291, name: 'Winbox',  proto: 'tcp' },
  { port: 22,   name: 'SSH',     proto: 'tcp' },
  { port: 80,   name: 'HTTP',    proto: 'tcp' },
  { port: 443,  name: 'HTTPS',   proto: 'tcp' },
  { port: 8728, name: 'API',     proto: 'tcp' },
  { port: 8729, name: 'API-SSL', proto: 'tcp' },
];

// Remove all netforge access-control rules from a given chain
async function cleanAccessRules(conn) {
  // Try regex removal first (RouterOS 7), then fall back to individual removes
  try { await conn.execute('/ip firewall filter remove [find comment~"netforge-access"]'); } catch {}
  try { await conn.execute('/ip firewall mangle remove [find comment~"netforge-brute"]'); } catch {}
  try { await conn.execute('/ip firewall filter remove [find comment~"netforge-brute-drop"]'); } catch {}
  try { await conn.execute('/ip firewall filter remove [find comment~"netforge-brute-block"]'); } catch {}
  try { await conn.execute('/ip firewall mangle remove [find comment~"netforge-brute-count"]'); } catch {}
  // Individual removes as fallback for older RouterOS
  for (const { name } of ACCESS_PORTS) {
    try { await conn.execute(`/ip firewall filter remove [find comment="netforge-access-allow-${name}"]`); } catch {}
    try { await conn.execute(`/ip firewall filter remove [find comment="netforge-access-drop-${name}"]`); } catch {}
    try { await conn.execute(`/ip firewall mangle remove [find comment="netforge-brute-track-${name}"]`); } catch {}
    try { await conn.execute(`/ip firewall filter remove [find comment="netforge-brute-drop-${name}"]`); } catch {}
    try { await conn.execute(`/ip firewall filter remove [find comment="netforge-brute-block-${name}"]`); } catch {}
  }
  try { await conn.execute('/ip firewall filter remove [find comment="netforge-brute-block"]'); } catch {}
  try { await conn.execute('/ip firewall filter remove [find comment="netforge-brute-drop"]'); } catch {}
}

// GET /api/access/status
app.get('/api/access/status', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const conn = getConnection(sessionId);

    const alOut = await conn.execute('/ip firewall address-list print');
    const alRows = parseRouterOSOutput(alOut);

    const allowedIps = alRows
      .filter(r => r.list === 'allowed_ips')
      .map(r => ({ id: r.numbers, address: r.address || '', comment: r.comment || '', disabled: r.disabled === 'true' }));

    const blockedIps = alRows
      .filter(r => r.list === 'blocked_ips' || r.list === 'login_attempts')
      .map(r => ({ id: r.numbers, address: r.address || '', list: r.list, comment: r.comment || '', timeout: r.timeout || '' }));

    const filterOut = await conn.execute('/ip firewall filter print');
    const active = filterOut.includes('netforge-access');

    const mangleOut = await conn.execute('/ip firewall mangle print');
    const bruteForceActive = mangleOut.includes('netforge-brute');

    res.json({ allowedIps, blockedIps, active, bruteForceActive });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/access/allowed-ip/add
app.post('/api/access/allowed-ip/add', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { address, comment } = req.body;
    if (!address) return res.status(400).json({ error: 'address required' });
    if (!/^[\d.:/]+$/.test(address) && !/^[\da-fA-F:./]+$/.test(address)) {
      return res.status(400).json({ error: 'Invalid IP/CIDR format' });
    }
    const conn = getConnection(sessionId);
    const commentPart = comment ? ` comment="${comment}"` : '';
    const out = await conn.execute(`/ip firewall address-list add list=allowed_ips address=${address}${commentPart}`);
    if (rosError(out)) return res.status(500).json({ error: out.trim().split('\n')[0] });
    res.json({ success: true, message: `${address} added to allowed_ips` });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/access/allowed-ip/remove
app.post('/api/access/allowed-ip/remove', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { id } = req.body;
    if (id === undefined) return res.status(400).json({ error: 'id required' });
    const conn = getConnection(sessionId);
    const out = await conn.execute(`/ip firewall address-list remove numbers=${id}`);
    if (rosError(out)) return res.status(500).json({ error: out.trim().split('\n')[0] });
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/access/apply — deploy full ruleset matching the user's reference script
app.post('/api/access/apply', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { ports = [8291, 22, 80, 443, 8728], bruteForce = true } = req.body;
    const conn = getConnection(sessionId);
    const report = [];

    // Safety: refuse to apply if no allowed IPs configured — would lock everyone out
    const alRows = parseRouterOSOutput(await conn.execute('/ip firewall address-list print where list=allowed_ips'));
    if (alRows.length === 0) {
      return res.status(400).json({ error: 'Add at least one allowed IP before applying — applying with an empty list locks everyone out.' });
    }

    // Clean up old netforge access rules before re-applying
    await cleanAccessRules(conn);

    // Build filter rules: for each protected port:
    //   1. ACCEPT from allowed_ips (must come BEFORE the drop rule)
    //   2. DROP from all others
    // The two rules form a pair — accept first, drop second.
    const selectedPorts = ACCESS_PORTS.filter(p => ports.includes(p.port));
    for (const { port, name, proto } of selectedPorts) {
      const aOut = await conn.execute(
        `/ip firewall filter add chain=input protocol=${proto} dst-port=${port} ` +
        `src-address-list=allowed_ips action=accept comment="netforge-access-allow-${name}"`
      );
      const dOut = await conn.execute(
        `/ip firewall filter add chain=input protocol=${proto} dst-port=${port} ` +
        `action=drop comment="netforge-access-drop-${name}"`
      );
      report.push({
        port, name,
        accept: rosError(aOut) ? `FAIL: ${aOut.trim().split('\n')[0]}` : 'OK',
        drop:   rosError(dOut) ? `FAIL: ${dOut.trim().split('\n')[0]}` : 'OK',
      });
    }

    // Brute-force protection (3-strike / 5-attempt approach):
    //   Filter: drop immediately if already in blocked_ips
    //   Mangle: count new connections per port → login_attempts list (1m TTL)
    //   Filter: after 5 new connections in 1m, add to blocked_ips (1d)
    if (bruteForce) {
      // Track new connection attempts per port
      for (const { port, name, proto } of selectedPorts) {
        // Step 1: if already in blocked_ips, drop immediately
        await conn.execute(`/ip firewall filter add chain=input protocol=${proto} dst-port=${port} src-address-list=blocked_ips action=drop comment="netforge-brute-drop-${name}"`);
        // Step 2: count new connections — add to login_attempts (5-attempt window)
        await conn.execute(`/ip firewall mangle add chain=prerouting protocol=${proto} dst-port=${port} connection-state=new action=add-src-to-address-list address-list=login_attempts address-list-timeout=1m comment="netforge-brute-track-${name}"`);
      }
      // Step 3: after 5 entries in login_attempts (meaning 5 new connections in 1m), add to blocked_ips
      // RouterOS counts address-list entries — use a second list for the threshold
      await conn.execute(`/ip firewall mangle add chain=prerouting src-address-list=login_attempts action=add-src-to-address-list address-list=login_attempts_count address-list-timeout=1m comment="netforge-brute-count"`);
      // Block IPs that have 5+ entries (approximated via connection-limit matcher)
      for (const { port, name, proto } of selectedPorts) {
        await conn.execute(`/ip firewall filter add chain=input protocol=${proto} dst-port=${port} connection-limit=5,32 src-address-list=!allowed_ips action=add-src-to-address-list address-list=blocked_ips address-list-timeout=1d comment="netforge-brute-block-${name}"`);
      }
      report.push({ bruteForce: true });
    }

    res.json({ success: true, message: `Access control applied for ${selectedPorts.length} ports`, report });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/access/remove — disable all access control
app.post('/api/access/remove', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const conn = getConnection(sessionId);
    await cleanAccessRules(conn);
    res.json({ success: true, message: 'Access control rules removed' });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/access/unblock-ip
app.post('/api/access/unblock-ip', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { id } = req.body;
    if (id === undefined) return res.status(400).json({ error: 'id required' });
    const conn = getConnection(sessionId);
    const out = await conn.execute(`/ip firewall address-list remove numbers=${id}`);
    if (rosError(out)) return res.status(500).json({ error: out.trim().split('\n')[0] });
    res.json({ success: true, message: 'IP unblocked' });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== TERMINAL — EXECUTE COMMAND ==========

app.post('/api/terminal/exec', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { command } = req.body;
    if (!command || typeof command !== 'string') return res.status(400).json({ error: 'command required' });
    // Reject obviously destructive commands
    const danger = /^\s*(\/system\s+reset|\/system\s+shutdown|\/system\s+reboot|\/file\s+remove|\/file\s+print.*remove)/i;
    if (danger.test(command)) return res.status(403).json({ error: 'Blocked: use the UI buttons for reboot/reset/shutdown' });
    const conn = getConnection(sessionId);
    const out = await conn.execute(command);
    res.json({ output: out || '(no output)' });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== VLANs ==========

app.get('/api/vlans', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const conn = getConnection(sessionId);
    const out = await conn.execute('/interface vlan print');
    const rows = parseRouterOSOutput(out);
    res.json(rows.map(r => ({
      id: r.numbers || '',
      name: r.name || '',
      vlanId: parseInt(r.vlan_id) || 0,
      interface: r.interface || '',
      running: r.running === 'true',
      disabled: r.disabled === 'true',
      comment: r.comment || '',
      mtu: r.mtu || '1500',
    })));
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vlans/add', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { name, vlanId, interface: iface, comment = '' } = req.body;
    if (!name || !/^[a-zA-Z0-9._-]{1,30}$/.test(name)) return res.status(400).json({ error: 'Invalid VLAN name (alphanumeric/._- max 30 chars)' });
    const vid = parseInt(vlanId);
    if (!vid || vid < 1 || vid > 4094) return res.status(400).json({ error: 'VLAN ID must be 1-4094' });
    if (!iface) return res.status(400).json({ error: 'Interface required' });
    const conn = getConnection(sessionId);
    const cmd = `/interface vlan add name="${name}" vlan-id=${vid} interface="${iface}"${comment ? ` comment="${comment}"` : ''}`;
    const out = await conn.execute(cmd);
    if (rosError(out)) return res.status(400).json({ error: out.trim() });
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vlans/remove', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const conn = getConnection(sessionId);
    const out = await conn.execute(`/interface vlan remove [find name="${name}"]`);
    if (rosError(out)) return res.status(400).json({ error: out.trim() });
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== FIREWALL EXTRAS ==========

app.get('/api/firewall/services', (req, res) => {
  const sessionId = req.headers['x-session-id'];
  if (!sessionId) return res.status(401).json({ error: 'No session' });
  const cats = { youtube:'Streaming',facebook:'Social',instagram:'Social',whatsapp:'Messaging',messenger:'Messaging',discord:'Chat',twitter:'Social',reddit:'Social',twitch:'Streaming',tiktok:'Social',netflix:'Streaming',adult:'Adult',torrents:'P2P',gambling:'Gambling',crypto:'Mining',snapchat:'Social' };
  const labels = { youtube:'YouTube',facebook:'Facebook',instagram:'Instagram',whatsapp:'WhatsApp',messenger:'Messenger',discord:'Discord',twitter:'Twitter / X',reddit:'Reddit',twitch:'Twitch',tiktok:'TikTok',netflix:'Netflix',adult:'Adult Content',torrents:'Torrents',gambling:'Gambling',crypto:'Crypto Mining',snapchat:'Snapchat' };
  res.json(Object.keys(BLOCK_SERVICE_DOMAINS).map(id => ({
    id, label: labels[id] || id, category: cats[id] || 'Other', domainCount: BLOCK_SERVICE_DOMAINS[id].length,
  })));
});

app.get('/api/firewall/connections', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const conn = getConnection(sessionId);
    const out = await conn.execute('/ip firewall connection print');
    if (/connection tracking is disabled/i.test(out)) return res.json({ disabled: true, rows: [] });
    const rows = parseRouterOSOutput(out);
    res.json({
      disabled: false,
      rows: rows.slice(0, 200).map(r => ({
        protocol: r.protocol || '',
        src: r.src_address || '',
        dst: r.dst_address || '',
        state: r.tcp_state || r.connection_state || '',
        bytes: r.orig_bytes || '0',
        replyBytes: r.repl_bytes || '0',
      })),
    });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/address-lists', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const conn = getConnection(sessionId);
    const out = await conn.execute('/ip firewall address-list print');
    const rows = parseRouterOSOutput(out);
    res.json(rows.map(r => ({
      id: r.numbers || '',
      list: r.list || '',
      address: r.address || '',
      comment: r.comment || '',
      disabled: r.disabled === 'true',
      dynamic: r.dynamic === 'true',
    })));
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/address-lists/add', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { list, address, comment = '' } = req.body;
    if (!list || !address) return res.status(400).json({ error: 'list and address required' });
    const conn = getConnection(sessionId);
    const out = await conn.execute(`/ip firewall address-list add list="${list}" address="${address}"${comment ? ` comment="${comment}"` : ''}`);
    if (rosError(out)) return res.status(400).json({ error: out.trim() });
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/address-lists/remove', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    const conn = getConnection(sessionId);
    const out = await conn.execute(`/ip firewall address-list remove numbers=${id}`);
    if (rosError(out)) return res.status(400).json({ error: out.trim() });
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/firewall/geo-blocks', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const conn = getConnection(sessionId);
    const out = await conn.execute('/ip firewall address-list print');
    const rows = parseRouterOSOutput(out);
    const blocked = {};
    for (const cc of Object.keys(GEO_BLOCKS)) blocked[cc] = rows.some(r => r.list === `netforge-geo-${cc}`);
    res.json({ countries: Object.entries(GEO_BLOCKS).map(([cc, info]) => ({ cc, label: info.label, cidrCount: info.ranges.length, blocked: blocked[cc] || false })) });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/firewall/geo-block', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const { country, block } = req.body;
    if (!country || !GEO_BLOCKS[country]) return res.status(400).json({ error: 'Unknown country code' });
    const conn = getConnection(sessionId);
    const listName = `netforge-geo-${country}`;
    const comment = `netforge-geo-${country}`;
    if (block) {
      for (const cidr of GEO_BLOCKS[country].ranges) {
        await conn.execute(`/ip firewall address-list add list="${listName}" address="${cidr}" comment="${comment}"`);
      }
      await conn.execute(`/ip firewall filter add chain=forward src-address-list="${listName}" action=drop comment="${comment}" place-before=0`);
    } else {
      await conn.execute(`/ip firewall address-list remove [find comment="${comment}"]`);
      await conn.execute(`/ip firewall filter remove [find comment="${comment}"]`);
    }
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== WireGuard KEY GENERATION ==========

app.post('/api/vpn/wireguard/generate-keys', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    getConnection(sessionId);
    const privBytes = crypto.randomBytes(32);
    privBytes[0] &= 248;
    privBytes[31] &= 127;
    privBytes[31] |= 64;
    const privateKey = privBytes.toString('base64');
    let publicKey = '';
    try {
      const der = Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), privBytes]);
      const privObj = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
      const pubObj = crypto.createPublicKey(privObj);
      const spki = pubObj.export({ type: 'spki', format: 'der' });
      publicKey = spki.slice(-32).toString('base64');
    } catch { publicKey = ''; }
    res.json({ privateKey, publicKey });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== CONFIG DIFF & SNAPSHOTS ==========

app.get('/api/config/export', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const conn = getConnection(sessionId);
    const out = await conn.execute('/export');
    res.json({ config: out });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/config/snapshot', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const conn = getConnection(sessionId);
    const out = await conn.execute('/export');
    const snaps = configSnapshots.get(sessionId) || [];
    const id = Date.now().toString();
    snaps.unshift({ id, ts: new Date().toISOString(), size: out.length, text: out });
    if (snaps.length > 10) snaps.pop();
    configSnapshots.set(sessionId, snaps);
    res.json({ id, ts: snaps[0].ts, size: out.length, lines: out.split('\n').length });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config/snapshots', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    getConnection(sessionId);
    const snaps = configSnapshots.get(sessionId) || [];
    res.json(snaps.map(({ id, ts, size }) => ({ id, ts, size })));
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config/snapshot/:id', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    getConnection(sessionId);
    const snaps = configSnapshots.get(sessionId) || [];
    const snap = snaps.find(s => s.id === req.params.id);
    if (!snap) return res.status(404).json({ error: 'Snapshot not found' });
    res.json({ id: snap.id, ts: snap.ts, text: snap.text });
  } catch (err) {
    if (err.message.includes('Invalid or expired session')) return res.status(401).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ========== NOTIFICATIONS ==========

app.get('/api/notifications/settings', (req, res) => {
  const sessionId = req.headers['x-session-id'];
  if (!sessionId) return res.status(401).json({ error: 'No session' });
  try { getConnection(sessionId); } catch (err) { return res.status(401).json({ error: err.message }); }
  const cfg = loadNotifConfig();
  res.json({
    type: cfg.type,
    telegram: { token: cfg.telegram?.token ? '***' : '', chatId: cfg.telegram?.chatId || '' },
    webhook: { url: cfg.webhook?.url || '' },
    thresholds: cfg.thresholds || { cpu: 90, memory: 95 },
    events: cfg.events || { cpuHigh: true, memHigh: true, wanDown: true },
  });
});

app.post('/api/notifications/settings', (req, res) => {
  const sessionId = req.headers['x-session-id'];
  if (!sessionId) return res.status(401).json({ error: 'No session' });
  try { getConnection(sessionId); } catch (err) { return res.status(401).json({ error: err.message }); }
  const { type, telegram, webhook, thresholds, events } = req.body;
  if (!['none', 'telegram', 'webhook'].includes(type)) return res.status(400).json({ error: 'type must be none|telegram|webhook' });
  const existing = loadNotifConfig();
  const tgToken = (telegram?.token && telegram.token !== '***') ? telegram.token : (existing.telegram?.token || '');
  saveNotifConfig({
    type,
    telegram: { token: tgToken, chatId: telegram?.chatId || '' },
    webhook: { url: webhook?.url || '' },
    thresholds: { cpu: parseInt(thresholds?.cpu) || 90, memory: parseInt(thresholds?.memory) || 95 },
    events: { cpuHigh: !!events?.cpuHigh, memHigh: !!events?.memHigh, wanDown: !!events?.wanDown },
  });
  res.json({ success: true });
});

app.post('/api/notifications/test', async (req, res) => {
  const sessionId = req.headers['x-session-id'];
  if (!sessionId) return res.status(401).json({ error: 'No session' });
  try { getConnection(sessionId); } catch (err) { return res.status(401).json({ error: err.message }); }
  const cfg = loadNotifConfig();
  if (cfg.type === 'none') return res.status(400).json({ error: 'Notifications not configured' });
  try {
    await sendNotification('✅ NetForge test notification — your alerts are working!');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to send: ${err.message}` });
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
          ['/api/system-stats',  () => fetchSystemStats(conn, sessionId)],
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

        // Server-side threshold alert checker
        try {
          const cfg = loadNotifConfig();
          if (cfg.type !== 'none') {
            const sh = statsHistory.get(sessionId);
            const COOLDOWN = 5 * 60 * 1000;
            const now = Date.now();
            const check = (key, condition, msg) => {
              if (condition && (now - (alertCooldowns.get(key) || 0)) > COOLDOWN) {
                alertCooldowns.set(key, now);
                sendNotification(msg).catch(() => {});
              }
            };
            if (sh) {
              const lastCpu = sh.cpu[sh.cpu.length - 1] || 0;
              const lastMem = sh.memory[sh.memory.length - 1] || 0;
              check('cpu-high', cfg.events?.cpuHigh && lastCpu >= (cfg.thresholds?.cpu || 90),    `⚠️ CPU at ${lastCpu}% (threshold: ${cfg.thresholds?.cpu || 90}%)`);
              check('mem-high', cfg.events?.memHigh && lastMem >= (cfg.thresholds?.memory || 95), `⚠️ Memory at ${lastMem}% (threshold: ${cfg.thresholds?.memory || 95}%)`);
            }
          }
        } catch {}
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
