'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const http   = require('http');

// Perfil descartável ANTES de carregar o Agent (config/logger leem os.homedir()).
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sisbanda-agent-pedido-'));
process.env.USERPROFILE = HOME;
process.env.HOME = HOME;
const CFG_DIR = path.join(HOME, 'AppData', 'Roaming', 'SisbandaAgent');
fs.mkdirSync(CFG_DIR, { recursive: true });
fs.writeFileSync(path.join(CFG_DIR, 'config.json'), JSON.stringify({ port: 0 }));

const winston = require('winston');
const WebSocket = require('ws');
const logger = require('../src/services/logger');
const { startServer } = require('../src/server');
const { enfileirar } = require('../src/services/executor');
const { criarCofre } = require('../src/services/credenciais');
const { _limparRegistro } = require('../src/services/segredos');
const pedidoDiaria = require('../src/modules/pedidoDiaria');
const {
  lancarDiarias, prepararExecucao, escolherJustificativa, escolherCidadeOrigem,
  MSG_SEM_CREDENCIAIS, MSG_SEM_REQUISITANTE,
} = require('../src/automations/pedidoDiaria');

const SENHA   = 'Zz-senha-do-teste-91';
const USUARIO = 'fulano.sead';

// Tudo o que o logger escreve, já formatado (o mesmo texto que vai ao arquivo).
const linhasLog = [];
class Captura extends winston.Transport {
  log(info, cb) { linhasLog.push(info[Symbol.for('message')]); cb(); }
}
logger.add(new Captura());

function criptoFalsa() {
  return {
    disponivel: () => true,
    cifrar:   (s) => Buffer.from(Buffer.from(s, 'utf8').toString('base64')),
    decifrar: (b) => Buffer.from(b.toString(), 'base64').toString('utf8'),
  };
}

let nArq = 0;
function cofreCom(cred) {
  const cofre = criarCofre({ arquivo: path.join(HOME, `cred-${nArq++}.dat`), cripto: criptoFalsa() });
  if (cred) cofre.salvar(cred);
  _limparRegistro(); // como num processo recém-aberto: só a leitura registra
  return cofre;
}

const CONFIG_OK = {
  seadRequisitante: 'REQUISITANTE DE TESTE',
  seadObjetivo: 'PARTICIPAR DE EVENTO',
  seadJustificativa: 'JUSTIFICATIVA PADRAO',
  seadCidadeOrigemPadrao: 'Joao Pessoa',
  janelaSequencial: false,
};

const PEDIDO = {
  tipoViagem: 'estadual',
  destinoUF: 'PB',
  destinoCidade: 'Campina Grande',
  dataSaida: '2026-11-23T08:00',
  dataRetorno: '2026-11-23T18:00',
  justificativa: null,
  integrantes: [{ nome: 'NOME COMPLETO DO INTEGRANTE', lotacao: null }],
};

// ── Dublê do navegador ───────────────────────────────────────────────────────
// `falharEm`: 'senha' → o campo de senha "estoura" ecoando o valor digitado;
// 'formulario' → o iframe do cadastro não aparece, com a senha na mensagem.
function navegadorFalso({ falharEm }) {
  const registro = { lancamentos: 0, chamadas: [], senhaRecebida: null, usuarioRecebido: null };
  const locator = () => ({
    first: () => locator(), click: async () => {}, isVisible: async () => false,
    waitFor: async () => {}, fill: async () => {}, count: async () => 0,
  });
  const frame = {
    evaluate: async (fn) => {
      if (String(fn).includes('password')) registro.chamadas.push('limpar-senha');
    },
  };
  const page = {
    goto: async () => {},
    waitForLoadState: async () => {},
    fill: async (sel, val) => {
      if (sel.includes('password')) {
        registro.senhaRecebida = val;
        if (falharEm === 'senha') throw new Error(`page.fill: Timeout digitando "${val}" em ${sel}`);
      } else {
        registro.usuarioRecebido = val;
      }
    },
    $$: async () => [],
    locator: () => locator(),
    keyboard: { press: async () => {} },
    waitForFunction: async () => {},
    url: () => 'https://sead.pb.gov.br/sgcda/menu_diaria/menu_diaria.php',
    getByText: () => locator(),
    waitForSelector: async (sel) => {
      if (falharEm === 'formulario' && sel.includes('iframe')) {
        throw new Error(`iframe do cadastro não abriu (sessão de ${USUARIO}:${SENHA})`);
      }
      return null;
    },
    click: async () => {},
    reload: async () => {},
    frames: () => [frame],
    mainFrame: () => frame,
    evaluate: async () => {},
    screenshot: async (o) => { registro.chamadas.push(`screenshot:${o.path}`); },
  };
  const browser = {
    newContext: async () => ({ newPage: async () => page }),
    on: (ev, cb) => { if (ev === 'disconnected') setImmediate(cb); },
    close: async () => {},
  };
  const lancar = async () => { registro.lancamentos++; return { browser, canal: 'msedge' }; };
  return { lancar, registro };
}

let server, port;
test.before(async () => {
  server = await new Promise((resolve, reject) => startServer(resolve, reject));
  port = server.address().port;
});
test.after(async () => {
  await new Promise(r => server.close(r));
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch {}
});

// ── Falha cedo, antes do navegador ───────────────────────────────────────────

test('sem credencial → erro claro e o navegador NÃO é lançado', async () => {
  const nav = navegadorFalso({});
  await assert.rejects(
    lancarDiarias(PEDIDO, () => {}, { cofre: cofreCom(null), config: CONFIG_OK, lancar: nav.lancar, esperar: async () => {} }),
    { message: MSG_SEM_CREDENCIAIS },
  );
  assert.equal(nav.registro.lancamentos, 0);
});

test('sem requisitante → erro claro e o navegador NÃO é lançado', async () => {
  const nav = navegadorFalso({});
  await assert.rejects(
    lancarDiarias(PEDIDO, () => {}, {
      cofre: cofreCom({ usuario: USUARIO, senha: SENHA }),
      config: { ...CONFIG_OK, seadRequisitante: '   ' },
      lancar: nav.lancar, esperar: async () => {},
    }),
    { message: MSG_SEM_REQUISITANTE },
  );
  assert.equal(nav.registro.lancamentos, 0);
});

test('cofre indisponível → falha antes de ler qualquer coisa', () => {
  const cofre = { disponivel: () => false, lerParaAutomacao: () => { throw new Error('não devia ler'); } };
  assert.throws(() => prepararExecucao({ cofre, config: CONFIG_OK }), /proteção de dados do Windows/);
});

test('pedido fora do contrato → recusado antes do navegador', async () => {
  const nav = navegadorFalso({});
  await assert.rejects(
    lancarDiarias({ ...PEDIDO, integrantes: [] }, () => {}, {
      cofre: cofreCom({ usuario: USUARIO, senha: SENHA }), config: CONFIG_OK, lancar: nav.lancar,
    }),
    /Pedido inválido/,
  );
  assert.equal(nav.registro.lancamentos, 0);
});

// ── Prioridades D4 e cidade de origem ────────────────────────────────────────

test('justificativa do pedido tem prioridade; vazia → padrão', () => {
  const exec = { justificativaPadrao: 'PADRAO' };
  assert.equal(escolherJustificativa({ justificativa: 'DIGITADA' }, exec), 'DIGITADA');
  assert.equal(escolherJustificativa({ justificativa: '   ' }, exec), 'PADRAO');
  assert.equal(escolherJustificativa({ justificativa: null }, exec), 'PADRAO');
});

test('cidade de origem: lotação do integrante > cidade padrão > vazio', () => {
  const exec = { cidadeOrigemPadrao: 'Joao Pessoa' };
  assert.deepEqual(escolherCidadeOrigem({ lotacao: 'Patos' }, exec), { cidade: 'Patos', fonte: 'lotacao' });
  assert.deepEqual(escolherCidadeOrigem({ lotacao: null }, exec), { cidade: 'Joao Pessoa', fonte: 'padrao' });
  assert.deepEqual(escolherCidadeOrigem({ lotacao: '' }, { cidadeOrigemPadrao: '' }), { cidade: '', fonte: null });
});

test('login usa usuário e senha do cofre (não do config.json nem do ambiente)', async () => {
  process.env.SEAD_USUARIO = 'do-ambiente';
  process.env.SEAD_SENHA   = 'senha-do-ambiente';
  try {
    const nav = navegadorFalso({ falharEm: 'senha' });
    await lancarDiarias(PEDIDO, () => {}, {
      cofre: cofreCom({ usuario: USUARIO, senha: SENHA }),
      config: { ...CONFIG_OK, seadUsuario: 'do-config', seadSenha: 'senha-do-config' },
      lancar: nav.lancar, esperar: async () => {},
    });
    assert.equal(nav.registro.usuarioRecebido, USUARIO);
    assert.equal(nav.registro.senhaRecebida === SENHA, true);
  } finally {
    delete process.env.SEAD_USUARIO;
    delete process.env.SEAD_SENHA;
  }
});

// ── A senha não vaza: passo, erro de job, log, WebSocket, /jobs, screenshot ──

function getJson(rota) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: rota }, res => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => resolve(JSON.parse(raw)));
    }).on('error', reject);
  });
}

async function rodarPelaFila(falharEm) {
  const nav = navegadorFalso({ falharEm });
  const cofre = cofreCom({ usuario: USUARIO, senha: SENHA });
  const modulo = {
    ...pedidoDiaria,
    execute: (payload, onStep) => pedidoDiaria.execute(payload, onStep, {
      cofre, config: CONFIG_OK, lancar: nav.lancar, esperar: async () => {},
      dirScreenshots: path.join(HOME, 'shots'),
    }),
  };

  const mensagensWs = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise(r => ws.on('open', r));
  ws.on('message', d => mensagensWs.push(String(d)));

  const r = enfileirar('pedido-diaria', PEDIDO, { getModule: () => modulo });
  assert.equal(r.status, 202);

  const fim = await new Promise(resolve => ws.on('message', d => {
    const ev = JSON.parse(String(d));
    if (ev.jobId === r.body.jobId && (ev.event === 'job_error' || ev.event === 'job_finished')) resolve(ev);
  }));
  ws.close();
  const job = await getJson(`/jobs/${r.body.jobId}`);
  return { nav, fim, job, mensagensWs };
}

function assertSemSenha(rotulo, texto) {
  assert.equal(String(texto).includes(SENHA), false, `${rotulo} contém a senha: ${texto}`);
}

test('erro no campo de senha ecoando o valor → nada sai com a senha', async () => {
  const antes = linhasLog.length;
  const { fim, job, mensagensWs } = await rodarPelaFila('senha');

  assert.equal(fim.event, 'job_error');
  assert.ok(job.steps.some(s => s.message.includes('[REDIGIDO]')), 'o passo de erro devia aparecer redigido');
  assertSemSenha('erro do job (WS)', fim.error);
  assertSemSenha('GET /jobs/:id', JSON.stringify(job));
  for (const m of mensagensWs) assertSemSenha('mensagem WS', m);
  for (const l of linhasLog.slice(antes)) assertSemSenha('log', l);
});

test('erro depois do login → screenshot com campos de senha limpos antes; nada sai com a senha', async () => {
  const antes = linhasLog.length;
  const { nav, fim, job, mensagensWs } = await rodarPelaFila('formulario');

  assert.equal(fim.event, 'job_error');
  const ch = nav.registro.chamadas;
  const iShot = ch.findIndex(c => c.startsWith('screenshot:'));
  assert.ok(iShot > 0, 'devia ter tirado screenshot do erro');
  assert.equal(ch[iShot - 1], 'limpar-senha', 'campos de senha precisam ser limpos antes do screenshot');
  assertSemSenha('nome do screenshot', ch[iShot]);
  assertSemSenha('erro do job (WS)', fim.error);
  assertSemSenha('GET /jobs/:id', JSON.stringify(job));
  for (const m of mensagensWs) assertSemSenha('mensagem WS', m);
  for (const l of linhasLog.slice(antes)) assertSemSenha('log', l);
});

test('arquivo agent.log do perfil de teste não contém a senha', async () => {
  await new Promise(r => setTimeout(r, 300)); // o transporte de arquivo grava em segundo plano
  const arq = path.join(CFG_DIR, 'logs', 'agent.log');
  assert.ok(fs.existsSync(arq));
  const conteudo = fs.readFileSync(arq, 'utf8');
  assert.ok(conteudo.includes('[REDIGIDO]'), 'o log devia registrar o erro, redigido');
  assertSemSenha('agent.log', conteudo);
});
