'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const http   = require('http');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sisbanda-agent-ipc-'));
process.env.USERPROFILE = HOME;
process.env.HOME = HOME;
const CFG_DIR = path.join(HOME, 'AppData', 'Roaming', 'SisbandaAgent');
fs.mkdirSync(CFG_DIR, { recursive: true });
fs.writeFileSync(path.join(CFG_DIR, 'config.json'), JSON.stringify({ port: 0 }));

const express = require('express');
const { registrarIpc, remetenteValido, CANAIS } = require('../src/ipc');
const { criarCofre } = require('../src/services/credenciais');
const { criarRouter, prontidao } = require('../src/routes/status');
const { loadConfig, atualizarConfig } = require('../src/config');
const { startServer } = require('../src/server');

const SENHA = 'senha-do-ipc-123';
const UI = 'http://localhost:9876';

function criptoFalsa() {
  return {
    disponivel: () => true,
    cifrar:   (s) => Buffer.from(Buffer.from(s).toString('base64')),
    decifrar: (b) => Buffer.from(b.toString(), 'base64').toString(),
  };
}

// Janela e eventos falsos com a forma que o Electron entrega ao ipcMain.handle.
function montar() {
  const handlers = new Map();
  const ipcMain = { handle: (canal, fn) => handlers.set(canal, fn) };
  const webContents = {};
  webContents.mainFrame = { url: `${UI}/ui`, parent: null };
  const janela = { webContents, isDestroyed: () => false };
  const cofre = criarCofre({ arquivo: path.join(HOME, `c-${Math.random()}.dat`), cripto: criptoFalsa() });
  const enfileirados = [];
  registrarIpc({
    ipcMain,
    janela: () => janela,
    origemUi: () => UI,
    cofre,
    lerConfig: loadConfig,
    atualizarConfig,
    enfileirar: (m, p) => { enfileirados.push([m, p]); return { status: 202, body: { jobId: 'job-1' } }; },
  });
  const evento = (over = {}) => ({ sender: webContents, senderFrame: webContents.mainFrame, ...over });
  const chamar = (canal, arg, ev = evento()) => handlers.get(canal)(ev, arg);
  return { handlers, chamar, evento, janela, cofre, enfileirados };
}

test.after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch {} });

test('canais do preload são exatamente os do ipc.js', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  const usados = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(usados, Object.values(CANAIS).sort());
  assert.doesNotMatch(preload, /exposeInMainWorld\([^)]*ipcRenderer\s*\)/); // não expõe o ipcRenderer cru
});

test('main.js cria a janela com preload, contextIsolation, sandbox e sem nodeIntegration', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /preload:\s+path\.join\(__dirname, 'preload\.js'\)/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /will-navigate/);
});

test('remetente: só o frame principal da janela do Agent, com a UI do Agent carregada', () => {
  const { evento, janela } = montar();
  assert.equal(remetenteValido(evento(), janela, UI), true);
  assert.equal(remetenteValido(evento({ sender: {} }), janela, UI), false);
  assert.equal(remetenteValido(evento({ senderFrame: { url: 'https://evil.example/', parent: null } }), janela, UI), false);
  assert.equal(remetenteValido(evento({ senderFrame: { url: `${UI}/ui`, parent: {} } }), janela, UI), false);
  assert.equal(remetenteValido(evento({ senderFrame: null }), janela, UI), false);
  assert.equal(remetenteValido(evento(), null, UI), false);
  assert.equal(remetenteValido(evento(), { ...janela, isDestroyed: () => true }, UI), false);
});

test('remetente estranho → nenhum handler executa', async () => {
  const { chamar, evento, cofre, enfileirados } = montar();
  const estranho = evento({ senderFrame: { url: 'https://evil.example/', parent: null } });
  for (const canal of Object.values(CANAIS)) {
    const r = await chamar(canal, { usuario: 'u', senha: SENHA }, estranho);
    assert.deepEqual(r, { ok: false, erro: 'Remetente não autorizado.' });
  }
  assert.equal(cofre.configuradas(), false);
  assert.equal(enfileirados.length, 0);
});

test('salvar credenciais pelo IPC: a senha nunca volta para a tela', async () => {
  const { chamar, cofre } = montar();
  const r = await chamar(CANAIS.SALVAR_CREDENCIAIS, { usuario: 'fulano', senha: SENHA });
  assert.equal(r.ok, true);
  assert.deepEqual(r.credenciais, { disponivel: true, configuradas: true, usuario: 'fulano' });
  assert.equal(JSON.stringify(r).includes(SENHA), false);
  assert.equal(cofre.lerParaAutomacao().senha, SENHA);

  const lido = await chamar(CANAIS.LER);
  assert.equal(JSON.stringify(lido).includes(SENHA), false);

  const apagado = await chamar(CANAIS.APAGAR_CREDENCIAIS);
  assert.equal(apagado.credenciais.configuradas, false);
});

test('parâmetros vão para o config.json, só as quatro chaves, e nunca senha', async () => {
  const { chamar } = montar();
  const r = await chamar(CANAIS.SALVAR_PARAMETROS, {
    requisitante: '  FULANA DE TAL  ', cidadeOrigemPadrao: 'Joao Pessoa',
    objetivo: 'PARTICIPAR DE EVENTO', justificativaPadrao: 'Texto',
    seadSenha: SENHA, port: 1,
  });
  assert.equal(r.ok, true);
  assert.equal(r.parametros.requisitante, 'FULANA DE TAL');
  const gravado = fs.readFileSync(path.join(CFG_DIR, 'config.json'), 'utf8');
  assert.equal(gravado.includes(SENHA), false);
  const cfg = JSON.parse(gravado);
  assert.equal(cfg.seadRequisitante, 'FULANA DE TAL');
  assert.equal(cfg.seadCidadeOrigemPadrao, 'Joao Pessoa');
  assert.equal(cfg.port, 0);

  const ruim = await chamar(CANAIS.SALVAR_PARAMETROS, { requisitante: 5 });
  assert.equal(ruim.ok, false);
});

test('pedido de teste vai para a mesma fila, módulo pedido-diaria, payload intacto', async () => {
  const { chamar, enfileirados } = montar();
  const payload = { tipoViagem: 'estadual' };
  const r = await chamar(CANAIS.PEDIDO_TESTE, payload);
  assert.deepEqual(r, { ok: true, jobId: 'job-1' });
  assert.deepEqual(enfileirados, [['pedido-diaria', payload]]);
});

test('/status informa só booleanos de prontidão', () => {
  const cofre = { configuradas: () => true };
  const p = prontidao({ cofre, config: { seadRequisitante: 'FULANA DE TAL' } });
  assert.deepEqual(p, { credenciaisConfiguradas: true, requisitanteConfigurado: true });
  assert.deepEqual(
    prontidao({ cofre: { configuradas: () => false }, config: { seadRequisitante: ' ' } }),
    { credenciaisConfiguradas: false, requisitanteConfigurado: false },
  );
});

test('/status por HTTP: booleanos presentes, nenhum valor de credencial ou requisitante', async (t) => {
  const cofre = criarCofre({ arquivo: path.join(HOME, 'status.dat'), cripto: criptoFalsa() });
  cofre.salvar({ usuario: 'usuario-secreto', senha: SENHA });
  const app = express();
  app.use(criarRouter({
    cofre,
    lerConfig: () => ({ seadRequisitante: 'REQUISITANTE SECRETO' }),
    checarNavegador: async () => ({ ok: true, canal: 'msedge' }),
  }));
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  t.after(() => new Promise(r => srv.close(r)));
  const corpo = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: '/status' }, res => {
      let raw = ''; res.on('data', d => { raw += d; }); res.on('end', () => resolve(raw));
    }).on('error', reject);
  });
  const json = JSON.parse(corpo);
  assert.equal(json.credenciaisConfiguradas, true);
  assert.equal(json.requisitanteConfigurado, true);
  for (const v of [SENHA, 'usuario-secreto', 'REQUISITANTE SECRETO']) assert.equal(corpo.includes(v), false, v);
});

test('não há rota HTTP para credenciais, configuração ou pedido de teste', async (t) => {
  const server = await new Promise((resolve, reject) => startServer(resolve, reject));
  t.after(() => new Promise(r => server.close(r)));
  const port = server.address().port;
  const rotas = [
    ['POST', '/credenciais'], ['GET', '/credenciais'], ['POST', '/api/credenciais'],
    ['POST', '/config'], ['GET', '/config'], ['POST', '/api/config'],
    ['POST', '/pedido-teste'], ['POST', '/api/pedido-teste'], ['POST', '/api/test'],
  ];
  for (const [method, rota] of rotas) {
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: rota, method }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 404, `${method} ${rota}`);
  }
  // E nenhuma rota conhece o cofre além do /status (que só lê booleanos).
  const dir = path.join(__dirname, '..', 'src', 'routes');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /lerParaAutomacao|\.salvar\(|\.apagar\(|resumo\(\)/, f);
  }
});
