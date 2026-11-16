'use strict';

const { launchNavegador } = require('../services/navegador');
const { setTimeout: sleep } = require('timers/promises');
const path = require('path');
const { loadConfig, CONFIG_DIR } = require('../config');
const { obterCofre, MSG_INDISPONIVEL } = require('../services/credenciais');
const { redigir } = require('../services/segredos');
const { validarPedido } = require('../modules/pedidoDiaria/contrato');

const LOGIN_URL    = 'https://sead.pb.gov.br/sgcda/app_Login/';
const CADASTRO_URL = 'https://sead.pb.gov.br/sgcda/menu_diaria/menu_diaria.php';

const MSG_SEM_CREDENCIAIS =
  'Credenciais do SEAD não configuradas. Abra a janela do SISBANDA Agent, aba Configuração, e cadastre usuário e senha.';
const MSG_SEM_REQUISITANTE =
  'Requisitante não configurado. Abra a janela do SISBANDA Agent, aba Configuração, e informe o requisitante como aparece no SEAD.';

function textoParaAutocomplete(s) {
  s = String(s || '').trim();
  return s.length <= 1 ? s : s.slice(0, -1);
}

function semAcentos(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[`'´]/g, '');
}

function digitacaoAutocompleteSemAcento(txt) {
  return textoParaAutocomplete(semAcentos(txt));
}

const UF_LABEL = {
  AC:'Acre',AL:'Alagoas',AP:'Amapa',AM:'Amazonas',BA:'Bahia',CE:'Ceara',
  DF:'Distrito Federal',ES:'Espirito Santo',GO:'Goias',MA:'Maranhao',
  MT:'Mato Grosso',MS:'Mato Grosso do Sul',MG:'Minas Gerais',PA:'Para',
  PB:'Paraiba',PR:'Parana',PE:'Pernambuco',PI:'Piaui',RJ:'Rio de Janeiro',
  RN:'Rio Grande do Norte',RS:'Rio Grande do Sul',RO:'Rondonia',RR:'Roraima',
  SC:'Santa Catarina',SP:'Sao Paulo',SE:'Sergipe',TO:'Tocantins',
};

function labelEstado(uf) {
  return UF_LABEL[String(uf || 'PB').trim().toUpperCase()] || 'Paraiba';
}

function normalizarTipo(t) {
  const u = String(t || 'ESTADUAL').trim().toUpperCase();
  return ['ESTADUAL','NACIONAL','INTERNACIONAL'].includes(u) ? u : 'ESTADUAL';
}

function partesDataHora(iso) {
  if (!iso) return { data: '', hora: '08:00' };
  const s = String(iso).trim().replace(/Z$/i, '');
  const [datePart, timePart = ''] = s.split('T');
  const [y, m, d] = (datePart || '').split('-').map(x => parseInt(x, 10));
  const data = y && m && d
    ? `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`
    : '';
  const tb = timePart.split(':');
  const hh = String(Math.min(23, parseInt(tb[0] || '8', 10))).padStart(2,'0');
  const mm = String(Math.min(59, parseInt(tb[1] || '0', 10))).padStart(2,'0');
  return { data, hora: `${hh}:${mm}` };
}

// ── Regras de preenchimento (puras, testadas) ────────────────────────────────

/** Justificativa digitada no pedido > justificativa padrão do Agent. */
function escolherJustificativa(pedido, exec) {
  const digitada = String(pedido.justificativa || '').trim();
  return digitada || String(exec.justificativaPadrao || '').trim();
}

/** Lotação do integrante > cidade de origem padrão do Agent. */
function escolherCidadeOrigem(integrante, exec) {
  const lotacao = String(integrante.lotacao || '').trim();
  if (lotacao) return { cidade: lotacao, fonte: 'lotacao' };
  const padrao = String(exec.cidadeOrigemPadrao || '').trim();
  if (padrao) return { cidade: padrao, fonte: 'padrao' };
  return { cidade: '', fonte: null };
}

/**
 * Lê cofre e configuração ANTES de qualquer navegador abrir. Falta de
 * credencial ou de requisitante encerra aqui, com mensagem clara.
 */
function prepararExecucao({ cofre, config }) {
  if (!cofre.disponivel()) throw new Error(MSG_INDISPONIVEL);
  const credenciais = cofre.lerParaAutomacao();
  if (!credenciais) throw new Error(MSG_SEM_CREDENCIAIS);
  const requisitante = String(config.seadRequisitante || '').trim();
  if (!requisitante) throw new Error(MSG_SEM_REQUISITANTE);
  return {
    credenciais,
    requisitante,
    objetivo:            String(config.seadObjetivo || '').trim(),
    justificativaPadrao: String(config.seadJustificativa || ''),
    cidadeOrigemPadrao:  String(config.seadCidadeOrigemPadrao || ''),
    janelaSequencial:    !!config.janelaSequencial,
  };
}

// ── Passos no SEAD ───────────────────────────────────────────────────────────

async function selecionarPorTexto(ctx, frame, name, needle) {
  if (!needle) return false;
  const ok = await frame.evaluate(({ name, n }) => {
    function sa(s) { return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase(); }
    const sel = document.querySelector(`select[name="${name}"]`);
    if (!sel) return false;
    const nn = sa(n);
    for (const opt of sel.options) {
      const t = (opt.textContent || '').trim();
      if (t && opt.value && sa(t).includes(nn)) {
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        sel.dispatchEvent(new Event('input',  { bubbles: true }));
        return true;
      }
    }
    return false;
  }, { name, n: needle }).catch(() => false);
  await ctx.esperar(400);
  return ok;
}

async function clicarSugestaoAutocomplete(ctx, frame, page, ref) {
  const r = semAcentos(ref).toLowerCase();
  if (!r) return false;
  const listas = [
    frame.locator('.ui-menu-item, li.ui-menu-item, li'),
    page.locator('.ui-autocomplete .ui-menu-item, ul.ui-autocomplete li'),
    page.locator('.ui-menu .ui-menu-item'),
    page.locator('[role="option"]'),
  ];
  for (const lista of listas) {
    let n = 0;
    try { n = await lista.count(); } catch { n = 0; }
    for (let i = 0; i < n; i++) {
      const item = lista.nth(i);
      if (!(await item.isVisible().catch(() => false))) continue;
      const txt = (await item.textContent().catch(() => '')) || '';
      if (semAcentos(txt).toLowerCase().includes(r)) {
        await item.click();
        await ctx.esperar(800);
        return true;
      }
    }
  }
  return false;
}

async function aguardarAutocomplete(ctx, frame, page, ref, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await clicarSugestaoAutocomplete(ctx, frame, page, ref)) return;
    await ctx.esperar(500);
  }
  throw new Error(`Autocomplete não consolidou para "${ref}" em ${ms}ms.`);
}

async function dadosInvalidos(page) {
  return page.getByText(/Dados\s*inválidos/i).first().isVisible({ timeout: 2500 }).catch(() => false);
}

async function esperarMenu(page) {
  await page.waitForSelector('#item_1, a[id="item_1"], a:has-text("CADASTRAR")', { timeout: 35000 }).catch(() => {});
}

async function login(page, { usuario, senha }) {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

  await page.fill('input[type="text"]:visible, input[name*="login"]:visible', usuario).catch(async () => {
    const inputs = await page.$$('input[type="text"]');
    if (inputs[0]) await inputs[0].fill(usuario);
  });
  await page.fill('input[type="password"]:visible', senha);

  const btn = page.locator('input[type="submit"], button[type="submit"], input[value*="Login"]').first();
  try { await btn.click({ timeout: 8000 }); } catch { await page.keyboard.press('Enter'); }

  await page.waitForFunction(() => !window.location.href.includes('app_Login'), { timeout: 60000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 90000 }).catch(() => {});

  if (page.url().includes('app_Login')) {
    await page.goto(CADASTRO_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 90000 }).catch(() => {});
  }
}

async function posLogin(ctx, page) {
  await ctx.esperar(1500);
  const ok = page.url().includes('menu_diaria') && !(await dadosInvalidos(page));
  if (ok) { await esperarMenu(page); return; }

  await page.goto(CADASTRO_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForLoadState('networkidle', { timeout: 90000 }).catch(() => {});
  await ctx.esperar(600);

  if (await dadosInvalidos(page)) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 90000 }).catch(() => {});
    await ctx.esperar(600);
  }
  await esperarMenu(page);
}

async function abrirCadastroDiaria(ctx, page) {
  await page.click('#item_1, a[id="item_1"]').catch(() => page.click('text=CADASTRAR'));
  await ctx.esperar(600);
  await page.click('#item_10, a[id="item_10"]').catch(() => page.click('text=Cadastro de Diária'));
  await ctx.esperar(1500);

  const fh = await page.waitForSelector('#menu_diaria_iframe, iframe[name="menu_diaria_iframe"]', { timeout: 20000 }).catch(() => null);
  if (fh) {
    const f = await fh.contentFrame();
    if (f) await f.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  }
  await ctx.esperar(2500);
}

async function obterFrame(page) {
  const fh = await page.waitForSelector('#menu_diaria_iframe, iframe[name="menu_diaria_iframe"]', { timeout: 20000 });
  return (await fh.contentFrame()) || page.mainFrame();
}

async function preencherRequisitante(ctx, page) {
  const { requisitante } = ctx.exec;
  const frame = await obterFrame(page);
  const campo = frame.locator('#id_ac_id_servidor_solicit');
  await campo.waitFor({ state: 'visible', timeout: 20000 });
  await campo.click();
  await campo.fill('');
  await campo.pressSequentially(digitacaoAutocompleteSemAcento(requisitante), { delay: 40 });
  await aguardarAutocomplete(ctx, frame, page, requisitante);
  await ctx.esperar(500);
}

async function preencherRequisitado(ctx, page, nomeCompleto) {
  const frame = await obterFrame(page);
  const campo = frame.locator(
    'input[name="id_servidor_autocomp"], input.sc-ui-autocomp-id_servidor'
  ).first();
  await campo.waitFor({ state: 'visible', timeout: 20000 });
  await campo.click();
  await campo.fill('');
  await campo.pressSequentially(digitacaoAutocompleteSemAcento(nomeCompleto), { delay: 40 });
  await aguardarAutocomplete(ctx, frame, page, nomeCompleto);
  await ctx.esperar(500);
}

async function preencherDestino(ctx, page, pedido, cidOrig) {
  const { objetivo } = ctx.exec;
  const frame = await obterFrame(page);

  const aba = frame.getByText(/DIÁRIAS\s*\/\s*DESTINO/i).first();
  if (await aba.isVisible({ timeout: 4000 }).catch(() => false)) {
    await aba.click();
    await ctx.esperar(700);
  }

  const selTipo = frame.locator('select[name="ds_tp_viagem"]');
  await selTipo.waitFor({ state: 'visible', timeout: 15000 });
  const tipo = normalizarTipo(pedido.tipoViagem);
  await selTipo.selectOption({ value: tipo }).catch(() => selTipo.selectOption({ label: tipo }).catch(() => {}));

  const saida = partesDataHora(pedido.dataSaida);
  const ret   = partesDataHora(pedido.dataRetorno);
  await frame.locator('input[name="dt_saida"]').fill(saida.data);
  await frame.locator('input[name="h_saida"]').fill(saida.hora);
  await frame.locator('input[name="dt_retorno"]').fill(ret.data);
  await frame.locator('input[name="h_retorno"]').fill(ret.hora);

  // Estado Origem (PB fixo)
  const selEstOrig = frame.locator('select[name="ds_est_origem"]');
  await selEstOrig.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  await frame.waitForFunction(() => {
    const s = document.querySelector('select[name="ds_est_origem"]');
    return s && s.options.length > 1;
  }, { timeout: 20000 }).catch(() => {});
  await ctx.esperar(500);
  await selEstOrig.selectOption({ label: 'Paraiba' }).catch(() => selecionarPorTexto(ctx, frame, 'ds_est_origem', 'paraiba'));

  // Cidade Origem (lotação do integrante ou cidade padrão do Agent)
  await ctx.esperar(1200);
  await frame.waitForFunction(() => {
    const s = document.querySelector('select[name="ds_cid_origem"]');
    return s && s.options.length > 1;
  }, { timeout: 20000 }).catch(() => {});
  await ctx.esperar(600);
  if (cidOrig) {
    const ok = await selecionarPorTexto(ctx, frame, 'ds_cid_origem', cidOrig);
    if (!ok) await selecionarPorTexto(ctx, frame, 'ds_cid_origem', semAcentos(cidOrig).split(/\s+/)[0]);
  }

  // Estado Destino
  const selEstDest = frame.locator('select[name="ds_est_destino"]');
  const labDest = labelEstado(pedido.destinoUF);
  await selEstDest.selectOption({ label: labDest }).catch(() => selecionarPorTexto(ctx, frame, 'ds_est_destino', labDest.toLowerCase()));
  await ctx.esperar(1200);

  // Cidade Destino
  const cidDest = (pedido.destinoCidade || '').trim();
  if (cidDest) {
    const selCid = frame.locator('select[name="ds_cid_destino_pricipal"]');
    await selCid.waitFor({ state: 'visible', timeout: 15000 });
    await frame.waitForFunction(() => {
      const s = document.querySelector('select[name="ds_cid_destino_pricipal"]');
      return s && s.options.length > 1;
    }, { timeout: 25000 }).catch(() => {});
    await ctx.esperar(800);
    const ok = await selecionarPorTexto(ctx, frame, 'ds_cid_destino_pricipal', cidDest);
    if (!ok) await selecionarPorTexto(ctx, frame, 'ds_cid_destino_pricipal', semAcentos(cidDest).split(/\s+/)[0]);
  }

  // Objetivo
  if (objetivo) {
    const selObj = frame.locator('select[name="ds_objetio"]');
    await selObj.waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
    await selObj.selectOption({ value: objetivo })
      .catch(() => selObj.selectOption({ label: objetivo })
      .catch(() => selecionarPorTexto(ctx, frame, 'ds_objetio', objetivo)));
    await ctx.esperar(500);
  }
}

async function preencherJustificativa(ctx, page, texto) {
  const frame = await obterFrame(page);

  const abaJustif = frame.locator('a:has-text("JUSTIFICATIVA")').first();
  await abaJustif.waitFor({ state: 'visible', timeout: 12000 });
  await abaJustif.click();
  await ctx.esperar(800);

  const textarea = frame.locator('textarea[name="ds_obs"], textarea#id_sc_field_ds_obs').first();
  await textarea.waitFor({ state: 'visible', timeout: 12000 });
  await textarea.click();
  await textarea.fill(texto);
  await ctx.esperar(400);
}

async function exibirMensagemFinal(page) {
  await page.evaluate(() => new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed','inset:0','z-index:2147483647',
      'background:rgba(0,0,0,0.65)',
      'display:flex','align-items:center','justify-content:center',
    ].join(';');

    const box = document.createElement('div');
    box.style.cssText = [
      'background:#fff','border-radius:8px','padding:32px 40px',
      'text-align:center','font-family:Arial,sans-serif',
      'max-width:480px','line-height:1.6',
    ].join(';');

    const msg = document.createElement('p');
    msg.textContent = 'Confira os dados do pedido, clique em "Incluir/Cancelar", e faça upload dos ofícios referentes ao evento na aba COMPROVAÇÃO. Em seguida, clique em Salvar para enviar o pedido ao sistema do Estado.';
    msg.style.cssText = 'font-size:14px;margin:0 0 24px;color:#222';

    const btn = document.createElement('button');
    btn.textContent = 'OK';
    btn.style.cssText = [
      'padding:10px 36px','font-size:14px','font-weight:bold',
      'background:#1a6fc4','color:#fff','border:none',
      'border-radius:5px','cursor:pointer',
    ].join(';');
    btn.onclick = () => { document.body.removeChild(overlay); resolve(); };

    box.appendChild(msg);
    box.appendChild(btn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }));
}

// Esvazia todo campo de senha, em todos os frames, antes de fotografar a tela.
async function limparCamposDeSenha(page) {
  const frames = typeof page.frames === 'function' ? page.frames() : [page.mainFrame()];
  for (const f of frames) {
    await f.evaluate(() => {
      document.querySelectorAll('input[type="password"]').forEach(i => { i.value = ''; });
    }).catch(() => {});
  }
}

async function salvarScreenshot(ctx, page, nomeCompleto) {
  try {
    await limparCamposDeSenha(page);
    const ts   = new Date().toISOString().replace(/[:.]/g, '-');
    const nome = semAcentos(nomeCompleto).replace(/[^A-Za-z0-9]+/g, '_');
    const file = path.join(ctx.dirScreenshots, `${nome}_${ts}.png`);
    await page.screenshot({ path: file, fullPage: true });
  } catch {}
}

async function abrirJanelaIntegrante(ctx, pedido, integrante, onStatus) {
  const nomeCompleto = integrante.nome;
  // Toda mensagem que sai daqui é redigida: um erro do navegador pode ecoar o
  // valor que estava sendo digitado.
  const emitir = (ev) => onStatus?.({
    ...ev,
    ...(ev.erro    ? { erro:    redigir(ev.erro) }    : {}),
    ...(ev.detalhe ? { detalhe: redigir(ev.detalhe) } : {}),
  });
  let browser;
  let falhou = false;
  try {
    ({ browser } = await ctx.lancar({ headless: false, args: ['--start-maximized'] }));
    const context = await browser.newContext({ viewport: null });
    const page    = await context.newPage();

    emitir({ integrante: nomeCompleto, status: 'login' });
    await login(page, ctx.exec.credenciais);
    await posLogin(ctx, page);
    emitir({ integrante: nomeCompleto, status: 'sessao_pronta' });

    emitir({ integrante: nomeCompleto, status: 'abrindo' });
    try {
      await abrirCadastroDiaria(ctx, page);
      await preencherRequisitante(ctx, page);
      await preencherRequisitado(ctx, page, nomeCompleto);

      const origem = escolherCidadeOrigem(integrante, ctx.exec);
      if (origem.fonte === 'padrao') {
        emitir({ integrante: nomeCompleto, status: 'aviso', detalhe: `sem lotação; cidade de origem padrão: ${origem.cidade}` });
      } else if (!origem.fonte) {
        emitir({ integrante: nomeCompleto, status: 'aviso', detalhe: 'sem lotação e sem cidade de origem padrão; Cidade Origem fica em branco' });
      }
      await preencherDestino(ctx, page, pedido, origem.cidade);
      await preencherJustificativa(ctx, page, escolherJustificativa(pedido, ctx.exec));
      await exibirMensagemFinal(page);

      if (await dadosInvalidos(page)) {
        falhou = true;
        emitir({ integrante: nomeCompleto, status: 'erro', erro: 'Página mostrou Dados inválidos.' });
      } else {
        emitir({ integrante: nomeCompleto, status: 'pronto' });
      }
    } catch (err) {
      falhou = true;
      await salvarScreenshot(ctx, page, nomeCompleto).catch(() => {});
      emitir({ integrante: nomeCompleto, status: 'erro', erro: err.message });
    }

    emitir({ integrante: nomeCompleto, status: 'aguardando_usuario' });
    await new Promise(resolve => browser.on('disconnected', resolve));
  } catch (err) {
    falhou = true;
    emitir({ integrante: nomeCompleto, status: 'erro', erro: err.message });
    await browser?.close().catch(() => {});
  }
  return !falhou;
}

/**
 * @param {object} pedidoBruto  payload no contrato de docs/contrato-pedido-diaria.md
 * @param {(ev:object)=>void} onStatus
 * @param {object} [deps]  injeção para testes: { cofre, config, lancar, esperar, dirScreenshots }
 * @returns {Promise<{ total: number, comErro: number }>}
 */
async function lancarDiarias(pedidoBruto, onStatus, deps = {}) {
  const v = validarPedido(pedidoBruto);
  if (!v.ok) throw new Error(`Pedido inválido: ${v.erros.join(' ')}`);
  const pedido = v.valor;

  // Antes de qualquer navegador: sem credencial ou requisitante, para aqui.
  const exec = prepararExecucao({
    cofre:  deps.cofre  || obterCofre(),
    config: deps.config || loadConfig(),
  });

  const ctx = {
    exec,
    lancar:         deps.lancar  || launchNavegador,
    esperar:        deps.esperar || sleep,
    dirScreenshots: deps.dirScreenshots || path.join(CONFIG_DIR, 'screenshots'),
  };

  const resultados = [];
  if (exec.janelaSequencial) {
    for (const int of pedido.integrantes) resultados.push(await abrirJanelaIntegrante(ctx, pedido, int, onStatus));
  } else {
    resultados.push(...await Promise.all(pedido.integrantes.map(int => abrirJanelaIntegrante(ctx, pedido, int, onStatus))));
  }
  return { total: resultados.length, comErro: resultados.filter(ok => !ok).length };
}

module.exports = {
  lancarDiarias,
  prepararExecucao,
  escolherJustificativa,
  escolherCidadeOrigem,
  salvarScreenshot,
  MSG_SEM_CREDENCIAIS,
  MSG_SEM_REQUISITANTE,
};
