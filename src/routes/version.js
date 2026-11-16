'use strict';

const express  = require('express');
const router   = express.Router();
const { VERSION }      = require('../versao');
const { getUpdateInfo } = require('../services/updater');

// 2: payload do pedido-diaria em docs/contrato-pedido-diaria.md e barreira de origem.
const PROTOCOL_VERSION = 2;

// GET /version
router.get('/version', (_req, res) => {
  let playwrightVersion = 'unknown';
  try { playwrightVersion = require('playwright/package.json').version; } catch {}

  res.json({
    agent:    VERSION,
    protocol: PROTOCOL_VERSION,
    playwright: playwrightVersion,
    update: getUpdateInfo(),
  });
});

module.exports = { router, PROTOCOL_VERSION };
