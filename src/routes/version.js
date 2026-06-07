'use strict';

const express  = require('express');
const router   = express.Router();
const { loadConfig }   = require('../config');
const { getUpdateInfo } = require('../services/updater');

const PROTOCOL_VERSION = 1;

// GET /version
router.get('/version', (_req, res) => {
  const cfg = loadConfig();
  let playwrightVersion = 'unknown';
  try { playwrightVersion = require('playwright/package.json').version; } catch {}

  res.json({
    agent:    cfg.agentVersion,
    protocol: PROTOCOL_VERSION,
    playwright: playwrightVersion,
    update: getUpdateInfo(),
  });
});

module.exports = { router, PROTOCOL_VERSION };
