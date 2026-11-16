'use strict';

const { launchNavegador } = require('../services/navegador');
const { setTimeout: sleep } = require('timers/promises');
const path = require('path');
const os   = require('os');
const { loadConfig } = require('../config');

const LOGIN_URL    = 'https://sead.pb.gov.br/sgcda/app_Login/';
const CADASTRO_URL = 'https://sead.pb.gov.br/sgcda/menu_diaria/menu_diaria.php';
const SCREENSHOT_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'SisbandaAgent', 'screenshots');

function cfg() { return loadConfig(); }

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

async function selecionarPorTexto(frame, name, needle) {
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
  await sleep(400);
  return ok;
}

async function clicarSugestaoAutocomplete(frame, page, ref) {
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
        await sleep(800);
        return true;
      }
    }
  }
  return false;
}

async function aguardarAutocomplete(frame, page, ref, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await clicarSugestaoAutocomplete(frame, page, ref)) return;
    await sleep(500);
  }
  throw new Error(`Autocomplete não consolidou para "${ref}" em ${ms}ms.`);
}

async function dadosInvalidos(page) {
  return page.getByText(/Dados\s*inválidos/i).first().isVisible({ timeout: 2500 }).catch(() => false);
}

async function esperarMenu(page) {
  await page.waitForSelector('#item_1, a[id="item_1"], a:has-text("CADASTRAR")', { timeout: 35000 }).catch(() => {});
}

async function login(page) {
  const { seadUsuario, seadSenha } = cfg();
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

  await page.fill('input[type="text"]:visible, input[name*="login"]:visible', seadUsuario).catch(async () => {
    const inputs = await page.$$('input[type="text"]');
    if (inputs[0]) await inputs[0].fill(seadUsuario);
  });
  await page.fill('input[type="password"]:visible', seadSenha);

  const btn = page.locator('input[type="submit"], button[type="submit"], input[value*="Login"]').first();
  try { await btn.click({ timeout: 8000 }); } catch { await page.keyboard.press('Enter'); }

  await page.waitForFunction(() => !window.location.href.includes('app_Login'), { timeout: 60000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 90000 }).catch(() => {});

  if (page.url().includes('app_Login')) {
    await page.goto(CADASTRO_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 90000 }).catch(() => {});
  }
}

async function posLogin(page) {
  await sleep(1500);
  const ok = page.url().includes('menu_diaria') && !(await dadosInvalidos(page));
  if (ok) { await esperarMenu(page); return; }

  await page.goto(CADASTRO_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForLoadState('networkidle', { timeout: 90000 }).catch(() => {});
  await sleep(600);

  if (await dadosInvalidos(page)) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 90000 }).catch(() => {});
    await sleep(600);
  }
  await esperarMenu(page);
}

async function abrirCadastroDiaria(page) {
  await page.click('#item_1, a[id="item_1"]').catch(() => page.click('text=CADASTRAR'));
  await sleep(600);
  await page.click('#item_10, a[id="item_10"]').catch(() => page.click('text=Cadastro de Diária'));
  await sleep(1500);

  const fh = await page.waitForSelector('#menu_diaria_iframe, iframe[name="menu_diaria_iframe"]', { timeout: 20000 }).catch(() => null);
  if (fh) {
    const f = await fh.contentFrame();
    if (f) await f.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  }
  await sleep(2500);
}

async function obterFrame(page) {
  const fh = await page.waitForSelector('#menu_diaria_iframe, iframe[name="menu_diaria_iframe"]', { timeout: 20000 });
  return (await fh.contentFrame()) || page.mainFrame();
}

async function preencherRequisitante(page) {
  const { seadRequisitante } = cfg();
  const frame = await obterFrame(page);
  const campo = frame.locator('#id_ac_id_servidor_solicit');
  await campo.waitFor({ state: 'visible', timeout: 20000 });
  await campo.click();
  await campo.fill('');
  await campo.pressSequentially(digitacaoAutocompleteSemAcento(seadRequisitante), { delay: 40 });
  await aguardarAutocomplete(frame, page, seadRequisitante);
  await sleep(500);
}

async function preencherRequisitado(page, nomeCompleto) {
  const frame = await obterFrame(page);
  const campo = frame.locator(
    'input[name="id_servidor_autocomp"], input.sc-ui-autocomp-id_servidor'
  ).first();
  await campo.waitFor({ state: 'visible', timeout: 20000 });
  await campo.click();
  await campo.fill('');
  await campo.pressSequentially(digitacaoAutocompleteSemAcento(nomeCompleto), { delay: 40 });
  await aguardarAutocomplete(frame, page, nomeCompleto);
  await sleep(500);
}

async function preencherDestino(page, pedido, musico) {
  const { seadObjetivo } = cfg();
  const frame = await obterFrame(page);

  const aba = frame.getByText(/DIÁRIAS\s*\/\s*DESTINO/i).first();
  if (await aba.isVisible({ timeout: 4000 }).catch(() => false)) {
    await aba.click();
    await sleep(700);
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
  await sleep(500);
  await selEstOrig.selectOption({ label: 'Paraiba' }).catch(() => selecionarPorTexto(frame, 'ds_est_origem', 'paraiba'));

  // Cidade Origem (lotação do músico)
  await sleep(1200);
  await frame.waitForFunction(() => {
    const s = document.querySelector('select[name="ds_cid_origem"]');
    return s && s.options.length > 1;
  }, { timeout: 20000 }).catch(() => {});
  await sleep(600);
  const cidOrig = (musico.lotacao || pedido.cidadeOrigem || '').trim();
  if (cidOrig) {
    const ok = await selecionarPorTexto(frame, 'ds_cid_origem', cidOrig);
    if (!ok) await selecionarPorTexto(frame, 'ds_cid_origem', semAcentos(cidOrig).split(/\s+/)[0]);
  }

  // Estado Destino
  const selEstDest = frame.locator('select[name="ds_est_destino"]');
  const labDest = labelEstado(pedido.destinoUF);
  await selEstDest.selectOption({ label: labDest }).catch(() => selecionarPorTexto(frame, 'ds_est_destino', labDest.toLowerCase()));
  await sleep(1200);

  // Cidade Destino
  const cidDest = (pedido.destinoCidade || '').trim();
  if (cidDest) {
    const selCid = frame.locator('select[name="ds_cid_destino_pricipal"]');
    await selCid.waitFor({ state: 'visible', timeout: 15000 });
    await frame.waitForFunction(() => {
      const s = document.querySelector('select[name="ds_cid_destino_pricipal"]');
      return s && s.options.length > 1;
    }, { timeout: 25000 }).catch(() => {});
    await sleep(800);
    const ok = await selecionarPorTexto(frame, 'ds_cid_destino_pricipal', cidDest);
    if (!ok) await selecionarPorTexto(frame, 'ds_cid_destino_pricipal', semAcentos(cidDest).split(/\s+/)[0]);
  }

  // Objetivo
  const selObj = frame.locator('select[name="ds_objetio"]');
  await selObj.waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
  await selObj.selectOption({ value: seadObjetivo })
    .catch(() => selObj.selectOption({ label: seadObjetivo })
    .catch(() => selecionarPorTexto(frame, 'ds_objetio', seadObjetivo)));
  await sleep(500);
}

async function preencherJustificativa(page) {
  const { seadJustificativa } = cfg();
  const frame = await obterFrame(page);

  const abaJustif = frame.locator('a:has-text("JUSTIFICATIVA")').first();
  await abaJustif.waitFor({ state: 'visible', timeout: 12000 });
  await abaJustif.click();
  await sleep(800);

  const textarea = frame.locator('textarea[name="ds_obs"], textarea#id_sc_field_ds_obs').first();
  await textarea.waitFor({ state: 'visible', timeout: 12000 });
  await textarea.click();
  await textarea.fill(seadJustificativa);
  await sleep(400);
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

async function salvarScreenshot(page, nomeCompleto) {
  try {
    const ts   = new Date().toISOString().replace(/[:.]/g, '-');
    const nome = semAcentos(nomeCompleto).replace(/\s+/g, '_');
    const file = require('path').join(SCREENSHOT_DIR, `${nome}_${ts}.png`);
    await page.screenshot({ path: file, fullPage: true });
  } catch {}
}

async function abrirJanelaIntegrante(pedido, integrante, onStatus) {
  const nomeCompleto = integrante.musico ? integrante.musico.nome : integrante.nome;
  let browser;
  try {
    ({ browser } = await launchNavegador({ headless: false, args: ['--start-maximized'] }));
    const context = await browser.newContext({ viewport: null });
    const page    = await context.newPage();

    onStatus?.({ integrante: nomeCompleto, status: 'login' });
    await login(page);
    await posLogin(page);
    onStatus?.({ integrante: nomeCompleto, status: 'sessao_pronta' });

    onStatus?.({ integrante: nomeCompleto, status: 'abrindo' });
    try {
      await abrirCadastroDiaria(page);
      await preencherRequisitante(page);
      await preencherRequisitado(page, nomeCompleto);

      const musico = integrante.musico || integrante;
      await preencherDestino(page, pedido, musico);
      await preencherJustificativa(page);
      await exibirMensagemFinal(page);

      if (await dadosInvalidos(page)) {
        onStatus?.({ integrante: nomeCompleto, status: 'erro', erro: 'Página mostrou Dados inválidos.' });
      } else {
        onStatus?.({ integrante: nomeCompleto, status: 'pronto' });
      }
    } catch (err) {
      await salvarScreenshot(page, nomeCompleto).catch(() => {});
      onStatus?.({ integrante: nomeCompleto, status: 'erro', erro: err.message });
    }

    onStatus?.({ integrante: nomeCompleto, status: 'aguardando_usuario' });
    await new Promise(resolve => browser.on('disconnected', resolve));
  } catch (err) {
    onStatus?.({ integrante: nomeCompleto, status: 'erro', erro: err.message });
    await browser?.close().catch(() => {});
  }
}

async function lancarDiarias(pedido, onStatus) {
  const integrantes = pedido.integrantes;
  if (cfg().janelaSequencial) {
    for (const int of integrantes) await abrirJanelaIntegrante(pedido, int, onStatus);
  } else {
    await Promise.all(integrantes.map(int => abrirJanelaIntegrante(pedido, int, onStatus)));
  }
}

module.exports = { lancarDiarias };
