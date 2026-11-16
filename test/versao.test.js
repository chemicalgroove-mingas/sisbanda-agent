'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const http   = require('http');

// Perfil de usuário descartável ANTES de carregar qualquer módulo do Agent:
// config.js e logger.js calculam a pasta a partir de os.homedir() no require.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sisbanda-agent-teste-'));
process.env.USERPROFILE = HOME;
process.env.HOME = HOME;
const CFG_DIR  = path.join(HOME, 'AppData', 'Roaming', 'SisbandaAgent');
const CFG_FILE = path.join(CFG_DIR, 'config.json');
fs.mkdirSync(CFG_DIR, { recursive: true });

// config.json "de uma versão antiga": versão errada gravada e porta 0 (efêmera).
fs.writeFileSync(CFG_FILE, JSON.stringify({ agentVersion: '0.0.1', port: 0 }));

// Versão falsa injetada no cache do require do package.json. Sem isto, um
// '1.0.0' cravado no código passaria no teste enquanto o package.json for 1.0.0.
const PKG_PATH = require.resolve('../package.json');
const PKG_VERSION = '9.9.9-teste';
require.cache[PKG_PATH] = {
  id: PKG_PATH, filename: PKG_PATH, loaded: true,
  exports: { ...JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')), version: PKG_VERSION },
};
const { loadConfig, atualizarConfig } = require('../src/config');
const { startServer } = require('../src/server');

function getJson(port, rota) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: rota }, res => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => resolve(JSON.parse(raw)));
    }).on('error', reject);
  });
}

test('versão do package.json é a fonte única; agentVersion antigo do config.json é ignorado', async (t) => {
  assert.notEqual(PKG_VERSION, '0.0.1');
  assert.equal(loadConfig().agentVersion, undefined);

  const server = await new Promise((resolve, reject) => startServer(resolve, reject));
  t.after(() => new Promise(r => server.close(r)));
  const port = server.address().port;

  assert.equal((await getJson(port, '/ping')).version, PKG_VERSION);
  assert.equal((await getJson(port, '/version')).agent, PKG_VERSION);
});

test('atualizarConfig grava só a chave alterada, sem congelar DEFAULTS no arquivo', () => {
  atualizarConfig({ iniciarComWindows: false });
  const gravado = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
  assert.equal(gravado.iniciarComWindows, false);
  assert.equal(gravado.port, 0);                 // o que já estava continua
  assert.equal('jwtSecret' in gravado, false);   // DEFAULT não foi copiado
  assert.equal('seadRequisitante' in gravado, false);
  assert.equal(loadConfig().iniciarComWindows, false);
});

test('startServer chama onError (e não derruba o processo) quando a porta está ocupada', { timeout: 5000 }, async (t) => {
  const ocupante = http.createServer();
  await new Promise(r => ocupante.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => ocupante.close(r)));
  atualizarConfig({ port: ocupante.address().port });

  const err = await new Promise((resolve, reject) =>
    startServer(() => reject(new Error('não devia ter escutado')), resolve));
  assert.equal(err.code, 'EADDRINUSE');
});

test.after(() => {
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch {}
});
