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
const SEGREDO_JWT = 'segredo-jwt-do-teste-a3';
// Os testes HTTP daqui exercitam o modo que confere o token (exigirToken: true);
// o padrão publicado (não conferir) está em test/exigirToken.test.js.
fs.writeFileSync(path.join(CFG_DIR, 'config.json'), JSON.stringify({ port: 0, jwtSecret: SEGREDO_JWT, exigirToken: true }));

const jwt = require('jsonwebtoken');
const winston = require('winston');
const WebSocket = require('ws');
const logger = require('../src/services/logger');
const { startServer } = require('../src/server');
const { enfileirar } = require('../src/services/executor');
const { listJobs } = require('../src/services/jobQueue');
const { criarCofre } = require('../src/services/credenciais');
const { _limparRegistro } = require('../src/services/segredos');
const { DEFAULT_JWT_SECRET } = require('../src/config');
const pedidoDiaria = require('../src/modules/pedidoDiaria');
const {
  lancarDiarias, prepararExecucao, MSG_SEM_CREDENCIAIS, CADASTRO_URL,
} = require('../src/automations/pedidoDiaria');

const SENHA   = 'Zz-senha-do-teste-91';
const USUARIO = 'fulano.sead';
const LOGIN_URL = 'https://sead.pb.gov.br/sgcda/app_Login/';

// Seletores e tempos da automação do Linux (backend/src/lib/automacaoDiaria.js),
// copiados literalmente: o Agent tem de se comportar igual.
const LINUX = {
  usuario:     'input[type="text"]:visible, input[name*="login"]:visible, input[name*="user"]:visible',
  botaoLogin:  'input[type="submit"], button[type="submit"], button:has-text("Login"), input[value*="Login"]',
  menuCadastrar: '#item_1, a[id="item_1"], a[title=""][onmouseover*="item_1"]',
  requisitado: 'input[name="id_servidor_autocomp"], ' +
               'input.sc-ui-autocomp-id_servidor.ui-autocomplete-input, ' +
               'input.sc-ui-autocomp-id_servidor.sc-js-input, ' +
               'input.sc-ui-autocomp-id_servidor',
  autocompleteMs: 120000,
  urlMenuMs: 20000,
};

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

// config.json de quem usou a 1.1.0: parâmetros gravados que NÃO podem mais valer.
const CONFIG_VELHO = {
  seadRequisitante: 'REQ DO CONFIG', seadObjetivo: 'OBJ DO CONFIG',
  seadJustificativa: 'JUST DO CONFIG', seadCidadeOrigemPadrao: 'CIDADE DO CONFIG',
  janelaSequencial: false,
};

const REQUISITANTE = 'JOSÉ DA SILVA TESTE';
const INTEGRANTE   = 'FULANA DE SOUZA TESTE';
const PEDIDO = {
  requisitante: REQUISITANTE,
  objetivo: 'PARTICIPAR DE EVENTO',
  justificativa: 'Justificativa vinda do site.',
  tipoViagem: 'estadual',
  destinoUF: 'PB',
  destinoCidade: 'Campina Grande',
  dataSaida: '2026-11-23T08:00',
  dataRetorno: '2026-11-23T18:00',
  integrantes: [{ nome: INTEGRANTE, cidadeOrigem: 'Santa Rita' }],
};

// ── Dublê do navegador, que grava o que a automação faz ──────────────────────
// `falharEm`: 'senha' → o campo de senha "estoura" ecoando o valor digitado;
//             'formulario' → o iframe do cadastro não aparece, com a senha na mensagem.
// `urlAposLogin`: para onde o SEAD vai depois do clique em Login.
// `urlAposEsperarMenu`: para onde vai durante o waitForURL (null = continua onde está).
// `sugestoes`: o que o autocomplete mostra para cada campo.
// `selecionaPorTexto(arg)`: resultado da busca de opção por texto num <select>.
const LISTA_FRAME = '.ui-menu-item, li.ui-menu-item, li';

function navegador(opcoes = {}) {
  const o = {
    falharEm: null,
    urlAposLogin: CADASTRO_URL,
    urlAposEsperarMenu: null,
    sugestoes: { requisitante: [REQUISITANTE], requisitado: [INTEGRANTE] },
    selecionaPorTexto: () => true,
    ...opcoes,
  };
  const reg = {
    lancamentos: 0, eventos: [], chamadas: [], selecoes: [], digitado: {}, digitadoEm: {},
    senhaRecebida: null, usuarioRecebido: null, status: [],
  };
  const relogio = { t: 0 };
  let url = 'about:blank';
  let campoAtual = null;
  const ev = (s) => reg.eventos.push(s);

  const campoDe = (sel) => (sel.includes('solicit') ? 'requisitante' : sel.includes('id_servidor') ? 'requisitado' : null);
  const lista = (itens) => ({ count: async () => itens.length, nth: (i) => itens[i] });
  const item = (texto) => ({
    isVisible: async () => true,
    textContent: async () => texto,
    click: async () => ev(`sugestao:${texto}`),
  });

  function loc(sel, dono) {
    const self = {
      first: () => self,
      click: async () => {
        ev(`click:${sel}`);
        if (dono === 'page' && sel.includes('input[type="submit"]')) url = o.urlAposLogin;
      },
      isVisible: async () => false,
      waitFor: async (op) => ev(`waitFor:${sel}:${op && op.state}`),
      fill: async (v) => ev(`fill:${sel}=${v}`),
      pressSequentially: async (texto) => {
        const c = campoDe(sel);
        if (c) { reg.digitado[c] = texto; reg.digitadoEm[c] = relogio.t; campoAtual = c; }
      },
      selectOption: async (opt) => ev(`selectOption:${sel}=${JSON.stringify(opt)}`),
      count: async () => 0,
      nth: () => self,
      textContent: async () => '',
    };
    return self;
  }

  const frame = {
    locator: (sel) => {
      ev(`frame.locator:${sel}`);
      if (sel === LISTA_FRAME) return lista((o.sugestoes[campoAtual] || []).map(item));
      return loc(sel, 'frame');
    },
    evaluate: async (fn, arg) => {
      if (String(fn).includes('password')) { reg.chamadas.push('limpar-senha'); return undefined; }
      if (arg && arg.name) { reg.selecoes.push({ name: arg.name, n: arg.n }); return o.selecionaPorTexto(arg); }
      return undefined;
    },
    waitForFunction: async () => {},
    waitForLoadState: async () => {},
    getByText: () => loc('getByText', 'frame'),
  };
  const page = {
    goto: async (u) => { ev(`goto:${u}`); url = u; },
    waitForLoadState: async (estado) => ev(`load:${estado}`),
    waitForURL: async (re, op) => {
      ev(`waitForURL:${re}:${op && op.timeout}`);
      if (o.urlAposEsperarMenu) url = o.urlAposEsperarMenu;
    },
    fill: async (sel, val) => {
      ev(`page.fill:${sel}`);
      if (sel.includes('password')) {
        reg.senhaRecebida = val;
        if (o.falharEm === 'senha') throw new Error(`page.fill: Timeout digitando "${val}" em ${sel}`);
      } else {
        reg.usuarioRecebido = val;
      }
    },
    $$: async () => [],
    locator: (sel) => (/ui-autocomplete|ui-menu|role="option"/.test(sel) ? lista([]) : loc(sel, 'page')),
    keyboard: { press: async (k) => ev(`tecla:${k}`) },
    waitForFunction: async () => {},
    url: () => url,
    getByText: () => loc('getByText', 'page'),
    waitForSelector: async (sel) => {
      if (sel.includes('iframe')) {
        if (o.falharEm === 'formulario') throw new Error(`iframe do cadastro não abriu (sessão de ${USUARIO}:${SENHA})`);
        return { contentFrame: async () => frame };
      }
      return null;
    },
    click: async (sel) => ev(`click:${sel}`),
    reload: async () => ev('reload'),
    frames: () => [frame],
    mainFrame: () => frame,
    evaluate: async () => {},        // overlay final: o "usuário" clica OK na hora
    screenshot: async (op) => { reg.chamadas.push(`screenshot:${op.path}`); },
  };
  const browser = {
    newContext: async () => ({ newPage: async () => page }),
    on: (e, cb) => { if (e === 'disconnected') setImmediate(cb); },
    close: async () => {},
  };
  const deps = {
    lancar:  async () => { reg.lancamentos++; return { browser, canal: 'msedge' }; },
    esperar: async (ms) => { relogio.t += ms; },
    agora:   () => relogio.t,
  };
  const onStatus = (e) => reg.status.push({ ...e, t: relogio.t });
  return { deps, reg, relogio, onStatus };
}

async function rodar(pedido, opcoes = {}, extra = {}) {
  const nav = navegador(opcoes);
  const r = await lancarDiarias(pedido, nav.onStatus, {
    cofre: cofreCom({ usuario: USUARIO, senha: SENHA }), config: CONFIG_VELHO,
    ...nav.deps, dirScreenshots: path.join(HOME, 'shots'), ...extra,
  });
  return { ...nav, r };
}

const gotos = (reg) => reg.eventos.filter(e => e.startsWith('goto:'));

let server, port;
test.before(async () => {
  server = await new Promise((resolve, reject) => startServer(resolve, reject));
  port = server.address().port;
});
test.after(async () => {
  await new Promise(r => server.close(r));
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch {}
});

// ── 1.1 Payload: tudo vem do site; falta → recusa antes do navegador ─────────

test('sem credencial → erro claro e o navegador NÃO é lançado', async () => {
  const nav = navegador();
  await assert.rejects(
    lancarDiarias(PEDIDO, () => {}, { cofre: cofreCom(null), config: {}, ...nav.deps }),
    { message: MSG_SEM_CREDENCIAIS },
  );
  assert.equal(nav.reg.lancamentos, 0);
});

test('cofre indisponível → falha antes de ler qualquer coisa', () => {
  const cofre = { disponivel: () => false, lerParaAutomacao: () => { throw new Error('não devia ler'); } };
  assert.throws(() => prepararExecucao({ cofre, config: {} }), /proteção de dados do Windows/);
});

test('requisitante, objetivo, justificativa ou cidade de origem faltando → recusado, navegador NÃO abre', async () => {
  const faltando = [
    ['requisitante', { ...PEDIDO, requisitante: '' }],
    ['objetivo', { ...PEDIDO, objetivo: undefined }],
    ['justificativa', { ...PEDIDO, justificativa: null }],
    ['cidadeOrigem', { ...PEDIDO, integrantes: [{ nome: INTEGRANTE }] }],
  ];
  for (const [campo, pedido] of faltando) {
    const nav = navegador();
    await assert.rejects(
      lancarDiarias(pedido, () => {}, { cofre: cofreCom({ usuario: USUARIO, senha: SENHA }), config: CONFIG_VELHO, ...nav.deps }),
      new RegExp(`Pedido inválido: .*${campo}`),
      campo,
    );
    assert.equal(nav.reg.lancamentos, 0, campo);
  }
});

function post(rota, corpo, token) {
  return new Promise((resolve, reject) => {
    const dados = JSON.stringify(corpo);
    const req = http.request({
      host: '127.0.0.1', port, path: rota, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados),
                 ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, res => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
    });
    req.on('error', reject);
    req.end(dados);
  });
}

test('HTTP: token assinado com a constante do código → 401 quando o config.json tem outro segredo', async () => {
  const token = jwt.sign({ sub: 'x' }, DEFAULT_JWT_SECRET, { expiresIn: '5m' });
  const r = await post('/api/run', { module: 'pedido-diaria', payload: PEDIDO }, token);
  assert.equal(r.status, 401);
});

test('HTTP: token certo + payload sem requisitante/objetivo/justificativa → 400 com o motivo, sem job', async () => {
  const token = jwt.sign({ sub: 'x' }, SEGREDO_JWT, { expiresIn: '5m' });
  const antes = listJobs().length;
  const { requisitante, objetivo, justificativa, ...semParametros } = PEDIDO;
  void requisitante; void objetivo; void justificativa;
  const r = await post('/api/run', { module: 'pedido-diaria', payload: semParametros }, token);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Payload inválido.');
  const detalhes = r.body.detalhes.join(' | ');
  assert.match(detalhes, /requisitante/);
  assert.match(detalhes, /objetivo/);
  assert.match(detalhes, /justificativa/);
  assert.equal(listJobs().length, antes);
});

test('os valores do payload chegam ao SEAD; os parâmetros antigos do config.json não', async () => {
  const { reg, r } = await rodar(PEDIDO);
  assert.deepEqual(r, { total: 1, comErro: 0 });
  // Requisitante e requisitado: sem acento, sem a última letra; clique na sugestão.
  assert.equal(reg.digitado.requisitante, 'JOSE DA SILVA TEST');
  assert.equal(reg.digitado.requisitado, 'FULANA DE SOUZA TEST');
  assert.ok(reg.eventos.includes(`sugestao:${REQUISITANTE}`));
  assert.ok(reg.eventos.includes(`sugestao:${INTEGRANTE}`));
  // Objetivo, justificativa, cidade de origem.
  assert.ok(reg.eventos.includes('selectOption:select[name="ds_objetio"]={"value":"PARTICIPAR DE EVENTO"}'));
  assert.ok(reg.eventos.includes(
    'fill:textarea[name="ds_obs"], textarea#id_sc_field_ds_obs=Justificativa vinda do site.'));
  assert.deepEqual(reg.selecoes.filter(s => s.name === 'ds_cid_origem'), [{ name: 'ds_cid_origem', n: 'Santa Rita' }]);
  // Estado de origem fixo na Paraíba, como no Linux.
  assert.ok(reg.eventos.includes('selectOption:select[name="ds_est_origem"]={"label":"Paraiba"}'));
  // Nada do config.json velho.
  const tudo = JSON.stringify(reg);
  assert.doesNotMatch(tudo, /DO CONFIG/);
});

test('objetivo é sempre selecionado (não depende de configuração)', async () => {
  const { reg } = await rodar({ ...PEDIDO, objetivo: 'OUTRO OBJETIVO' }, {}, { config: {} });
  assert.ok(reg.eventos.includes('selectOption:select[name="ds_objetio"]={"value":"OUTRO OBJETIVO"}'));
});

// ── 1.3 Igual ao Linux: seletores, esperas e tempos ─────────────────────────

test('login, menu e requisitado usam os mesmos seletores do Linux', async () => {
  const { reg } = await rodar(PEDIDO);
  assert.equal(reg.eventos.find(e => e.startsWith('page.fill:') && !e.includes('password')), `page.fill:${LINUX.usuario}`);
  assert.ok(reg.eventos.includes(`click:${LINUX.botaoLogin}`), 'botão de login');
  assert.ok(reg.eventos.includes(`click:${LINUX.menuCadastrar}`), 'menu CADASTRAR');
  assert.ok(reg.eventos.includes(`frame.locator:${LINUX.requisitado}`), 'campo requisitado');
});

test('login: espera load e depois networkidle', async () => {
  const { reg } = await rodar(PEDIDO);
  const iClique = reg.eventos.indexOf(`click:${LINUX.botaoLogin}`);
  const cargas = reg.eventos.slice(iClique).filter(e => e.startsWith('load:'));
  assert.deepEqual(cargas.slice(0, 2), ['load:load', 'load:networkidle']);
});

test('login: ainda em app_Login → espera até 20 s pela URL menu_diaria e, se chegar, NÃO força o cadastro', async () => {
  const { reg } = await rodar(PEDIDO, { urlAposLogin: LOGIN_URL, urlAposEsperarMenu: CADASTRO_URL });
  assert.ok(reg.eventos.includes(`waitForURL:/menu_diaria/i:${LINUX.urlMenuMs}`));
  assert.deepEqual(gotos(reg), [`goto:${LOGIN_URL}`]);
});

test('login: ainda em app_Login depois da espera → só então vai direto ao cadastro', async () => {
  const { reg } = await rodar(PEDIDO, { urlAposLogin: LOGIN_URL });
  const iEspera = reg.eventos.indexOf(`waitForURL:/menu_diaria/i:${LINUX.urlMenuMs}`);
  const iGoto   = reg.eventos.indexOf(`goto:${CADASTRO_URL}`);
  assert.ok(iEspera >= 0, 'devia esperar a URL do menu');
  assert.ok(iGoto > iEspera, 'o goto do cadastro vem depois da espera');
});

test('login: já saiu de app_Login → não espera a URL do menu', async () => {
  const { reg } = await rodar(PEDIDO);
  assert.equal(reg.eventos.some(e => e.startsWith('waitForURL:')), false);
});

test('pós-login: fora do menu → vai ao cadastro e espera load antes de networkidle', async () => {
  const { reg } = await rodar(PEDIDO, { urlAposLogin: 'https://sead.pb.gov.br/sgcda/inicio/' });
  const iGoto = reg.eventos.indexOf(`goto:${CADASTRO_URL}`);
  assert.ok(iGoto >= 0);
  const cargas = reg.eventos.slice(iGoto).filter(e => e.startsWith('load:'));
  assert.deepEqual(cargas.slice(0, 2), ['load:load', 'load:networkidle']);
});

test('autocomplete do requisitante espera 120 s antes de desistir', async () => {
  const { reg } = await rodar(PEDIDO, { sugestoes: { requisitante: [], requisitado: [INTEGRANTE] } });
  const erro = reg.status.find(s => s.status === 'erro');
  assert.ok(erro, 'devia falhar no requisitante');
  assert.match(erro.erro, new RegExp(`em ${LINUX.autocompleteMs}ms`));
  assert.equal(erro.t - reg.digitadoEm.requisitante, LINUX.autocompleteMs);
});

test('autocomplete do requisitado espera 120 s antes de desistir', async () => {
  const { reg } = await rodar(PEDIDO, { sugestoes: { requisitante: [REQUISITANTE], requisitado: [] } });
  const erro = reg.status.find(s => s.status === 'erro');
  assert.ok(erro, 'devia falhar no requisitado');
  assert.match(erro.erro, new RegExp(`"${INTEGRANTE}" em ${LINUX.autocompleteMs}ms`));
  assert.equal(erro.t - reg.digitadoEm.requisitado, LINUX.autocompleteMs);
});

test('cidade de origem: espera o select ficar visível antes de escolher (como no Linux)', async () => {
  const { reg } = await rodar(PEDIDO);
  const iEspera = reg.eventos.indexOf('waitFor:select[name="ds_cid_origem"]:visible');
  const iEstado = reg.eventos.indexOf('selectOption:select[name="ds_est_origem"]={"label":"Paraiba"}');
  assert.ok(iEspera > iEstado, 'espera o select de cidade depois de escolher o estado');
});

// ── D11 mantida: primeira palavra só se o nome inteiro falhar ───────────────

test('cidade de origem achada pelo nome inteiro NÃO é trocada pela primeira palavra (D11)', async () => {
  const { reg } = await rodar(PEDIDO, { selecionaPorTexto: () => true });
  assert.deepEqual(reg.selecoes.filter(s => s.name === 'ds_cid_origem').map(s => s.n), ['Santa Rita']);
});

test('cidade de origem não achada pelo nome inteiro → tenta a primeira palavra (como no Linux)', async () => {
  const { reg } = await rodar(PEDIDO, { selecionaPorTexto: (a) => !(a.name === 'ds_cid_origem' && a.n === 'Santa Rita') });
  assert.deepEqual(reg.selecoes.filter(s => s.name === 'ds_cid_origem').map(s => s.n), ['Santa Rita', 'Santa']);
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
  const nav = navegador({ falharEm });
  const cofre = cofreCom({ usuario: USUARIO, senha: SENHA });
  const modulo = {
    ...pedidoDiaria,
    execute: (payload, onStep) => pedidoDiaria.execute(payload, onStep, {
      cofre, config: {}, ...nav.deps, dirScreenshots: path.join(HOME, 'shots'),
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

test('login usa usuário e senha do cofre (não do config.json nem do ambiente)', async () => {
  process.env.SEAD_USUARIO = 'do-ambiente';
  process.env.SEAD_SENHA   = 'senha-do-ambiente';
  try {
    const { reg } = await rodar(PEDIDO, { falharEm: 'senha' }, {
      config: { ...CONFIG_VELHO, seadUsuario: 'do-config', seadSenha: 'senha-do-config' },
    });
    assert.equal(reg.usuarioRecebido, USUARIO);
    assert.equal(reg.senhaRecebida === SENHA, true);
  } finally {
    delete process.env.SEAD_USUARIO;
    delete process.env.SEAD_SENHA;
  }
});

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
  const ch = nav.reg.chamadas;
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
