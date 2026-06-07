'use strict';

const express = require('express');
const router  = express.Router();
const https   = require('https');
const fs      = require('fs');
const os      = require('os');
const { chromium } = require('playwright');
const { CONFIG_DIR } = require('../config');
const { listModules } = require('../modules');

async function checkInternet() {
  return new Promise(resolve => {
    https.get('https://www.google.com', { timeout: 5000 }, () => resolve(true))
      .on('error', () => resolve(false))
      .on('timeout', () => resolve(false));
  });
}

async function checkChromium() {
  try {
    const b = await chromium.launch({ headless: true });
    await b.close();
    return true;
  } catch { return false; }
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
  const [internet, chromiumOk] = await Promise.all([checkInternet(), checkChromium()]);

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
    playwright:      true,
    chromium:        chromiumOk,
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
