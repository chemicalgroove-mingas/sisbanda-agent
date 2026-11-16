'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const http   = require('http');

// Perfil descartável ANTES de carregar o Agent (config/logger leem os.homedir()).
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sisbanda-agent-origem-'));
process.env.USERPROFILE = HOME;
process.env.HOME = HOME;
const CFG_DIR = path.join(HOME, 'AppData', 'Roaming', 'SisbandaAgent');
fs.mkdirSync(CFG_DIR, { recursive: true });
fs.writeFileSync(path.join(CFG_DIR, 'config.json'), JSON.stringify({ port: 0 }));

const WebSocket = require('ws');
const { startServer } = require('../src/server');
const { criarBarreira } = require('../src/services/origem');

const SITE  = 'https://pcpb.sisbanda.com.br';
const DEV   = 'http://localhost:3000';
const EVIL  = 'https://evil.example';

let server, port;
test.before(async () => {
  server = await new Promise((resolve, reject) => startServer(resolve, reject));
  port = server.address().port;
});
test.after(async () => {
  await new Promise(r => server.close(r));
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch {}
});

function pedir({ method = 'GET', rota = '/ping', headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: rota, method,
      headers: { host: `localhost:${port}`, ...headers },
    }, res => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: raw }));
    });
    req.on('error', reject);
    req.end();
  });
}

function preflight(origin) {
  return pedir({
    method: 'OPTIONS', rota: '/api/run',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization,content-type',
    },
  });
}

function abrirWs(headers) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { host: `localhost:${port}`, ...headers } });
    ws.on('message', d => {
      const ev = JSON.parse(String(d));
      ws.close();
      resolve({ aceito: true, evento: ev.event });
    });
    ws.on('unexpected-response', (_req, res) => resolve({ aceito: false, status: res.statusCode }));
    ws.on('error', () => resolve({ aceito: false, status: null }));
  });
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

test('origem permitida (site e localhost:3000) → 200 com a origem ecoada no CORS', async () => {
  for (const origin of [SITE, DEV]) {
    const r = await pedir({ headers: { origin } });
    assert.equal(r.status, 200, origin);
    assert.equal(r.headers['access-control-allow-origin'], origin);
    assert.notEqual(r.headers['access-control-allow-origin'], '*');
  }
});

test('origem da própria UI do Agent → 200', async () => {
  const r = await pedir({ headers: { origin: `http://localhost:${port}` } });
  assert.equal(r.status, 200);
});

test('origem estranha → 403, sem cabeçalho CORS', async () => {
  for (const origin of [EVIL, 'null', 'http://localhost:3001', 'https://pcpb.sisbanda.com.br.evil.example']) {
    const r = await pedir({ headers: { origin } });
    assert.equal(r.status, 403, origin);
    assert.equal(r.headers['access-control-allow-origin'], undefined, origin);
    assert.match(JSON.parse(r.body).error, /Origem não permitida/);
  }
});

test('sem cabeçalho Origin → aceito (navegação direta, curl)', async () => {
  const r = await pedir({});
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).status, 'online');
});

test('preflight: origem estranha → 403; origem permitida → 204 com os métodos', async () => {
  const ruim = await preflight(EVIL);
  assert.equal(ruim.status, 403);
  assert.equal(ruim.headers['access-control-allow-origin'], undefined);

  const bom = await preflight(SITE);
  assert.equal(bom.status, 204);
  assert.equal(bom.headers['access-control-allow-origin'], SITE);
  assert.match(bom.headers['access-control-allow-methods'], /POST/);
});

test('Host estranho (DNS rebinding) → 403, mesmo sem Origin', async () => {
  const r = await pedir({ headers: { host: `evil.example:${port}` } });
  assert.equal(r.status, 403);
  assert.match(JSON.parse(r.body).error, /Host não permitido/);
  const outraPorta = await pedir({ headers: { host: 'localhost:1234' } });
  assert.equal(outraPorta.status, 403);
});

// ── WebSocket ────────────────────────────────────────────────────────────────

test('WS: origem permitida → conecta e recebe "connected"', async () => {
  assert.deepEqual(await abrirWs({ origin: SITE }), { aceito: true, evento: 'connected' });
});

test('WS: sem Origin → conecta', async () => {
  assert.deepEqual(await abrirWs({}), { aceito: true, evento: 'connected' });
});

test('WS: origem estranha → handshake recusado com 403', async () => {
  assert.deepEqual(await abrirWs({ origin: EVIL }), { aceito: false, status: 403 });
  assert.deepEqual(await abrirWs({ origin: 'null' }), { aceito: false, status: 403 });
});

// ── Unidade ──────────────────────────────────────────────────────────────────

test('lista do config.json é normalizada e a UI entra sempre, mesmo com lista vazia', () => {
  const b = criarBarreira({ origens: ['HTTPS://Exemplo.gov.br/', 42, ''], porta: () => 9876 });
  assert.equal(b.origemPermitida('https://exemplo.gov.br'), true);
  assert.equal(b.origemPermitida('http://localhost:9876'), true);
  assert.equal(b.origemPermitida('http://127.0.0.1:9876'), true);
  assert.equal(b.origemPermitida(SITE), false); // lista própria substitui a padrão
  assert.equal(b.origemPermitida(undefined), true);
  assert.equal(b.origemPermitida(''), false);
});
