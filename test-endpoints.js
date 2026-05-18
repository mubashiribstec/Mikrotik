const http = require('http');

const BASE_URL = `http://localhost:${process.env.PORT || 4444}`;
const tests = [];
let passed = 0;
let failed = 0;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': 'test-session-invalid',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test(name, method, path, expectedStatus) {
  try {
    const result = await request(method, path);
    const pass = result.status === expectedStatus;
    if (pass) {
      console.log(`✓ ${name}`);
      passed++;
    } else {
      console.log(`✗ ${name} (expected ${expectedStatus}, got ${result.status})`);
      failed++;
    }
  } catch (err) {
    console.log(`✗ ${name} (${err.message})`);
    failed++;
  }
}

async function runTests() {
  console.log('Testing NetForge API Endpoints...\n');

  await test('GET / (HTML)', 'GET', '/', 200);
  await test('GET /index.html', 'GET', '/index.html', 200);
  await test('POST /api/login (empty body)', 'POST', '/api/login', 400);
  await test('GET /api/system-stats (no session)', 'GET', '/api/system-stats', 401);
  await test('GET /api/interfaces (no session)', 'GET', '/api/interfaces', 401);
  await test('GET /api/firewall (no session)', 'GET', '/api/firewall', 401);
  await test('GET /api/logs (no session)', 'GET', '/api/logs', 401);
  await test('GET /api/wireless (no session)', 'GET', '/api/wireless', 401);
  await test('GET /api/dhcp-clients (no session)', 'GET', '/api/dhcp-clients', 401);
  await test('GET /api/vpn (no session)', 'GET', '/api/vpn', 401);
  await test('GET /api/backups (no session)', 'GET', '/api/backups', 401);
  await test('GET /api/routes (no session)', 'GET', '/api/routes', 401);
  await test('GET /api/nat (no session)', 'GET', '/api/nat', 401);
  await test('GET /api/hotspot (no session)', 'GET', '/api/hotspot', 401);
  await test('GET /api/ip-addresses (no session)', 'GET', '/api/ip-addresses', 401);
  await test('GET /api/wan-status (no session)', 'GET', '/api/wan-status', 401);
  await test('GET /api/bandwidth (no session)', 'GET', '/api/bandwidth', 401);
  await test('GET /api/scripts (no session)', 'GET', '/api/scripts', 401);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
