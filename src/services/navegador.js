'use strict';

/**
 * Lançamento do navegador usado pelas automações.
 *
 * O Agent NÃO empacota Chromium: usa o navegador que já existe no Windows.
 * Ordem fixa: Microsoft Edge (vem com o Windows 10/11) → Google Chrome.
 * Se nenhum dos dois abrir, falha com mensagem clara em português.
 *
 * Todo lugar que precisa de navegador (automação, /status, /diagnostics) passa
 * por aqui, para que o que o painel informa seja exatamente o que a automação usa.
 */

const CANAIS = ['msedge', 'chrome'];

const MENSAGEM_SEM_NAVEGADOR =
  'Nenhum navegador compatível encontrado: instale ou atualize o Microsoft Edge';

function lancadorPadrao(opcoes) {
  // require tardio: os testes injetam um dublê e não carregam o Playwright.
  return require('playwright').chromium.launch(opcoes);
}

function primeiraLinha(err) {
  return String((err && err.message) || err).split('\n')[0];
}

/**
 * Abre o navegador do sistema.
 * @param {object} opcoes  opções do chromium.launch (headless, args...). `channel` é ignorado.
 * @param {object} [deps]  { lancar } — injeção para testes.
 * @returns {Promise<{ browser: import('playwright').Browser, canal: string }>}
 */
async function launchNavegador(opcoes = {}, { lancar = lancadorPadrao } = {}) {
  const tentativas = [];
  for (const canal of CANAIS) {
    try {
      const browser = await lancar({ ...opcoes, channel: canal });
      return { browser, canal };
    } catch (err) {
      tentativas.push(`${canal}: ${primeiraLinha(err)}`);
    }
  }
  const erro = new Error(MENSAGEM_SEM_NAVEGADOR);
  erro.code = 'SEM_NAVEGADOR';
  erro.tentativas = tentativas;
  throw erro;
}

/**
 * Abre e fecha o navegador em modo invisível, só para saber se funciona.
 * @returns {Promise<{ ok: boolean, canal: string|null, erro?: string, tentativas?: string[] }>}
 */
async function verificarNavegador(deps) {
  try {
    const { browser, canal } = await launchNavegador({ headless: true }, deps);
    await browser.close().catch(() => {});
    return { ok: true, canal };
  } catch (err) {
    return { ok: false, canal: null, erro: err.message, tentativas: err.tentativas || [] };
  }
}

module.exports = { launchNavegador, verificarNavegador, CANAIS, MENSAGEM_SEM_NAVEGADOR };
