'use strict';

const express  = require('express');
const router   = express.Router();
const { chromium } = require('playwright');
const { loadConfig }  = require('../config');
const { isBusy, listJobs } = require('../services/jobQueue');

const VERSION = loadConfig().agentVersion;

let browserInstalled = null;
async function checkBrowser() {
  if (browserInstalled !== null) return browserInstalled;
  try {
    const b = await chromium.launch({ headless: true });
    await b.close();
    browserInstalled = true;
  } catch {
    browserInstalled = false;
  }
  return browserInstalled;
}

// GET /ping
router.get('/ping', (_req, res) => {
  res.json({ status: 'online', version: VERSION });
});

// GET /status
router.get('/status', async (_req, res) => {
  const bOk = await checkBrowser().catch(() => false);

  const jobs   = listJobs();
  const lastDone = jobs.find(j => j.status === 'done' || j.status === 'error');

  res.json({
    agent:            true,
    version:          VERSION,
    playwright:       true,
    browserInstalled: bOk,
    busy:             isBusy(),
    lastRun:          lastDone?.finishedAt ?? null,
  });
});

module.exports = { router };
