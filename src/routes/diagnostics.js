'use strict';

const express = require('express');
const router  = express.Router();
const https   = require('https');
const fs      = require('fs');
const os      = require('os');
const { CONFIG_DIR } = require('../config');
const { listModules } = require('../modules');
const { VERSION } = require('../versao');
const { verificarNavegador } = require('../services/navegador');

async function checkInternet() {
  return new Promise(resolve => {
    https.get('https://www.google.com', { timeout: 5000 }, () => resolve(true))
      .on('error', () => resolve(false))
      .on('timeout', () => resolve(false));
  });
}

function diskFreeMb() {
  try {
    const s = fs.statfsSync ? fs.statfsSync(os.homedir()) : null;
    if (!s) return null;
    return Math.floor((s.bsize * s.bfree) / (1024 * 1024));
  } catch { return null; }
}

// GET /diagnostics
router.get('/diagnostics', async (_req, res) => {
  // Sem cache: o diagnóstico sempre lança o navegador de verdade.
  const [internet, nav] = await Promise.all([checkInternet(), verificarNavegador()]);

  const logsDir = `${CONFIG_DIR}\\logs`;
  const logsOk  = fs.existsSync(logsDir);
  let writeOk   = false;
  try {
    const testFile = `${CONFIG_DIR}\\.write_test`;
    fs.writeFileSync(testFile, '1');
    fs.unlinkSync(testFile);
    writeOk = true;
  } catch {}

  res.json({
    agent:           true,
    version:         VERSION,
    playwright:      true,
    // `chromium` mantido por compatibilidade com o painel do site; significa
    // "há navegador compatível" (Edge ou Chrome), não Chromium empacotado.
    chromium:        nav.ok,
    browserChannel:  nav.canal,
    ...(nav.ok ? {} : { browserError: nav.erro, browserAttempts: nav.tentativas }),
    internet,
    writePermission: writeOk,
    logsFolder:      logsOk,
    diskFreeMb:      diskFreeMb(),
    platform:        os.platform(),
    arch:            os.arch(),
    nodeVersion:     process.version,
    modules:         listModules(),
  });
});

module.exports = router;
