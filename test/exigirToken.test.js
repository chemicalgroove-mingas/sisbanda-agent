'use strict';

// exigirToken (config.json): só o booleano false desliga a conferência do token
// em POST /api/run. A barreira de origem continua valendo de qualquer jeito.

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const http   = require('http');

// Perfil descartável ANTES de carregar o Agent (config/logger leem os.homedir()).
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sisbanda-agent-token-'));
process.env.USERPROFILE = HOME;
process.env.HOME = HOME;
const CFG_DIR  = path.join(HOME, 'AppData', 'Roaming', 'SisbandaAgent');
const CFG_FILE = path.join(CFG_DIR, 'config.json');
fs.mkdirSync(CFG_DIR, { recursive: true });
const SEGREDO_JWT = 'segredo-jwt-do-teste-exigir-token';
const gravarConfig = (extra) =>
  fs.writeFileSync(CFG_FILE, JSON.stringify({ port: 0, jwtSecret: SEGREDO_JWT, ...extra }));

// O Agent parte com exigirToken = false (é o cenário desta máquina).
gravarConfig({ exigirToken: false });

const jwt     = require('jsonwebtoken');
const winston = require('winston');
const logger  = require('../src/services/logger');
const { tokenExigido, loadConfig } = require('../src/config');
const { listJobs } = require('../src/services/jobQueue');

const linhasLog = [];
class Captura extends winston.Transport {
  log(info, cb) { linhasLog.push({ level: info.level, msg: String(info.message) }); cb(); }
}
logger.add(new Captura());

const { startServer } = require('../src/server');

const SITE = 'https://pcpb.sisbanda.com.br';
const EVIL = 'https://evil.example';
// Payload que o contrato recusa: sem nenhum dos campos obrigatórios.
const INVALIDO = { module: 'pedido-diaria', payload: { tipoViagem: 'estadual' } };

let server, port;
test.before(async () => {
  server = await new Promise((resolve, reject) => startServer(resolve, reject));
  port = server.address().port;
});
test.after(async () => {
  await new Promise(r => server.close(r));
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch {}
});
test.afterEach(() => gravarConfig({ exigirToken: false }));

function pedir({ method = 'POST', rota = '/api/run', corpo, token, origin, extra = {} }) {
  return new Promise((resolve, reject) => {
    const dados = corpo === undefined ? '' : JSON.stringify(corpo);
    const req = http.request({
      host: '127.0.0.1', port, path: rota, method,
      headers: {
        host: `localhost:${port}`,
        ...(dados ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(origin ? { Origin: origin } : {}),
        ...extra,
      },
    }, res => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        let body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.end(dados || undefined);
  });
}

// ── Leitura da opção ─────────────────────────────────────────────────────────

test('tokenExigido: ausente → true (padrão seguro)', () => {
  assert.equal(tokenExigido({}), true);
  assert.equal(tokenExigido({ exigirToken: undefined }), true);
});

test('tokenExigido: só o booleano false desliga; "false", 0, null, "" continuam exigindo', () => {
  assert.equal(tokenExigido({ exigirToken: false }), false);
  for (const v of ['false', 0, null, '', 'no', true]) {
    assert.equal(tokenExigido({ exigirToken: v }), true, `valor ${JSON.stringify(v)}`);
  }
});

test('config.json sem a chave → loadConfig traz exigirToken = true', () => {
  fs.writeFileSync(CFG_FILE, JSON.stringify({ port: 0 }));
  assert.equal(loadConfig().exigirToken, true);
  assert.equal(tokenExigido(), true);
});

// ── exigirToken = true ───────────────────────────────────────────────────────

test('true + token inválido → 401, sem job', async () => {
  gravarConfig({ exigirToken: true });
  const antes = listJobs().length;
  const r = await pedir({ corpo: INVALIDO, token: 'token-qualquer', origin: SITE });
  assert.equal(r.status, 401);
  assert.equal(listJobs().length, antes);
});

test('true + token assinado com outro segredo → 401', async () => {
  gravarConfig({ exigirToken: true });
  const token = jwt.sign({ sub: 'x' }, 'outro-segredo', { expiresIn: '5m' });
  const r = await pedir({ corpo: INVALIDO, token, origin: SITE });
  assert.equal(r.status, 401);
});

test('true + sem token → 401', async () => {
  gravarConfig({ exigirToken: true });
  const r = await pedir({ corpo: INVALIDO, origin: SITE });
  assert.equal(r.status, 401);
});

test('chave ausente no config.json → exige token (401)', async () => {
  fs.writeFileSync(CFG_FILE, JSON.stringify({ port: 0, jwtSecret: SEGREDO_JWT }));
  const r = await pedir({ corpo: INVALIDO, token: 'token-qualquer', origin: SITE });
  assert.equal(r.status, 401);
});

test('exigirToken = "false" (texto) → continua exigindo (401)', async () => {
  gravarConfig({ exigirToken: 'false' });
  const r = await pedir({ corpo: INVALIDO, origin: SITE });
  assert.equal(r.status, 401);
});

test('true + token certo → segue para a validação do payload (400)', async () => {
  gravarConfig({ exigirToken: true });
  const token = jwt.sign({ sub: 'x' }, SEGREDO_JWT, { expiresIn: '5m' });
  const r = await pedir({ corpo: INVALIDO, token, origin: SITE });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Payload inválido.');
});

// ── exigirToken = false ──────────────────────────────────────────────────────

test('false + sem token → segue para a validação do payload (400), sem job', async () => {
  const antes = listJobs().length;
  const r = await pedir({ corpo: INVALIDO, origin: SITE });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Payload inválido.');
  assert.match(r.body.detalhes.join(' | '), /requisitante/);
  assert.equal(listJobs().length, antes);
});

test('false + token qualquer → segue para a validação do payload (400), sem job', async () => {
  const antes = listJobs().length;
  const r = await pedir({ corpo: INVALIDO, token: 'token-qualquer', origin: SITE });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Payload inválido.');
  assert.equal(listJobs().length, antes);
});

test('false NÃO desliga a barreira de origem: origem estranha → 403, sem job', async () => {
  const antes = listJobs().length;
  const r = await pedir({ corpo: INVALIDO, origin: EVIL });
  assert.equal(r.status, 403);
  assert.equal(listJobs().length, antes);
});

test('false NÃO desliga a barreira de origem: preflight de origem estranha → 403', async () => {
  const r = await pedir({
    method: 'OPTIONS', origin: EVIL,
    extra: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' },
  });
  assert.equal(r.status, 403);
});

test('false NÃO desliga a barreira de Host (DNS rebinding) → 403', async () => {
  const r = await pedir({ corpo: INVALIDO, extra: { host: `evil.example:${port}` } });
  assert.equal(r.status, 403);
});

// ── Visibilidade ─────────────────────────────────────────────────────────────

test('/status informa tokenExigido: false quando desligado e true quando ligado', async () => {
  let r = await pedir({ method: 'GET', rota: '/status' });
  assert.equal(r.status, 200);
  assert.equal(r.body.tokenExigido, false);

  gravarConfig({ exigirToken: true });
  r = await pedir({ method: 'GET', rota: '/status' });
  assert.equal(r.body.tokenExigido, true);
});

test('partida com exigirToken = false registra aviso no log', () => {
  const avisos = linhasLog.filter(l => l.level === 'warn' && /exigirToken = false/.test(l.msg));
  assert.equal(avisos.length, 1);
  assert.match(avisos[0].msg, /NÃO confere o token/);
});
