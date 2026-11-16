'use strict';

const express  = require('express');
const { VERSION } = require('../versao');
const { verificarNavegador } = require('../services/navegador');
const { isBusy, listJobs } = require('../services/jobQueue');
const { obterCofre } = require('../services/credenciais');

/**
 * Prontidão para o pedido de diária. Só um booleano: nem usuário nem senha
 * saem por HTTP. O resto do pedido vem do site.
 */
function prontidao({ cofre }) {
  return {
    credenciaisConfiguradas: cofre.configuradas() === true,
  };
}

function criarRouter({ cofre = obterCofre(), checarNavegador = verificarNavegador } = {}) {
  const router = express.Router();

  // O site consulta /status a cada 30 s. Só o SUCESSO fica em cache: se o
  // navegador faltar, a próxima consulta tenta de novo (o usuário pode ter
  // instalado/atualizado o Edge nesse meio-tempo).
  let navegadorOk = null;
  async function checkBrowser() {
    if (navegadorOk) return navegadorOk;
    const r = await checarNavegador();
    if (r.ok) navegadorOk = r;
    return r;
  }

  // GET /ping
  router.get('/ping', (_req, res) => {
    res.json({ status: 'online', version: VERSION });
  });

  // GET /status
  router.get('/status', async (_req, res) => {
    const nav = await checkBrowser().catch(() => ({ ok: false, canal: null }));

    const jobs   = listJobs();
    const lastDone = jobs.find(j => j.status === 'done' || j.status === 'error');

    res.json({
      agent:            true,
      version:          VERSION,
      playwright:       true,
      browserInstalled: nav.ok,
      browserChannel:   nav.canal,
      ...(nav.ok ? {} : { browserError: nav.erro }),
      busy:             isBusy(),
      lastRun:          lastDone?.finishedAt ?? null,
      ...prontidao({ cofre }),
    });
  });

  return router;
}

module.exports = { router: criarRouter(), criarRouter, prontidao };
