'use strict';

// Verificação de atualização: o Agent consulta GET /api/agent/info do backend
// do site, que devolve { version, protocol, download } com "download" relativo.
// Versão publicada menor ou igual à instalada → nada a oferecer.

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// Perfil descartável ANTES de carregar o Agent (config/logger leem os.homedir()).
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sisbanda-agent-updater-'));
process.env.USERPROFILE = HOME;
process.env.HOME = HOME;
const CFG_DIR  = path.join(HOME, 'AppData', 'Roaming', 'SisbandaAgent');
const CFG_FILE = path.join(CFG_DIR, 'config.json');
fs.mkdirSync(CFG_DIR, { recursive: true });
fs.writeFileSync(CFG_FILE, JSON.stringify({}));

const { verificarAtualizacao, getUpdateInfo, maisNovo, URL_INFO_PADRAO } = require('../src/services/updater');

test.after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch {} });
test.afterEach(() => fs.writeFileSync(CFG_FILE, JSON.stringify({})));

// O que o backend em produção devolve hoje.
const INFO_PRODUCAO = { version: '1.0.0', protocol: 1, download: '/api/agent/download' };

function busca(resposta) {
  const urls = [];
  const fn = async (url) => {
    urls.push(url);
    if (resposta instanceof Error) throw resposta;
    return resposta;
  };
  fn.urls = urls;
  return fn;
}

test('consulta https://sisbanda-backend.onrender.com/api/agent/info por padrão', async () => {
  assert.equal(URL_INFO_PADRAO, 'https://sisbanda-backend.onrender.com/api/agent/info');
  const buscar = busca(INFO_PRODUCAO);
  await verificarAtualizacao({ buscar, versaoLocal: '1.2.0' });
  assert.deepEqual(buscar.urls, ['https://sisbanda-backend.onrender.com/api/agent/info']);
});

test('updateUrl do config.json troca o endereço consultado', async () => {
  fs.writeFileSync(CFG_FILE, JSON.stringify({ updateUrl: 'https://outro.exemplo/api/agent/info' }));
  const buscar = busca(INFO_PRODUCAO);
  await verificarAtualizacao({ buscar, versaoLocal: '1.2.0' });
  assert.deepEqual(buscar.urls, ['https://outro.exemplo/api/agent/info']);
});

test('resposta de produção (1.0.0) com 1.2.0 instalado → nada a oferecer', async () => {
  const r = await verificarAtualizacao({ buscar: busca(INFO_PRODUCAO), versaoLocal: '1.2.0' });
  assert.equal(r.available, false);
  assert.equal(r.version, '1.0.0');
  assert.equal(getUpdateInfo(), r);
});

test('versão igual à instalada → nada a oferecer', async () => {
  const r = await verificarAtualizacao({ buscar: busca({ ...INFO_PRODUCAO, version: '1.2.0' }), versaoLocal: '1.2.0' });
  assert.equal(r.available, false);
});

test('versão maior → oferece, com o download relativo resolvido no backend', async () => {
  for (const v of ['1.2.1', '1.3.0', '2.0.0']) {
    const r = await verificarAtualizacao({ buscar: busca({ ...INFO_PRODUCAO, version: v }), versaoLocal: '1.2.0' });
    assert.equal(r.available, true, v);
    assert.equal(r.version, v);
    assert.equal(r.downloadUrl, 'https://sisbanda-backend.onrender.com/api/agent/download');
  }
});

test('comparação numérica, não de texto: 1.10.0 > 1.9.0', () => {
  assert.equal(maisNovo('1.10.0', '1.9.0'), true);
  assert.equal(maisNovo('1.9.0', '1.10.0'), false);
  assert.equal(maisNovo('1.2.0', '1.2.0'), false);
});

test('download absoluto fica como está; formato antigo (downloadUrl) ainda é aceito', async () => {
  let r = await verificarAtualizacao({
    buscar: busca({ version: '9.0.0', download: 'https://github.com/x/y/releases/latest/download/SisbandaAgentSetup.exe' }),
    versaoLocal: '1.2.0',
  });
  assert.equal(r.downloadUrl, 'https://github.com/x/y/releases/latest/download/SisbandaAgentSetup.exe');
  r = await verificarAtualizacao({ buscar: busca({ version: '9.0.0', downloadUrl: '/baixar' }), versaoLocal: '1.2.0' });
  assert.equal(r.downloadUrl, 'https://sisbanda-backend.onrender.com/baixar');
});

test('falha de rede → nada a oferecer, sem lançar', async () => {
  const r = await verificarAtualizacao({ buscar: busca(new Error('getaddrinfo ENOTFOUND')), versaoLocal: '1.2.0' });
  assert.equal(r.available, false);
});

test('resposta sem versão → nada a oferecer', async () => {
  const r = await verificarAtualizacao({ buscar: busca({ download: '/api/agent/download' }), versaoLocal: '1.2.0' });
  assert.equal(r.available, false);
});
