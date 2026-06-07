'use strict';

const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const { loadConfig }   = require('../config');
const { getModule, listModules } = require('../modules');
const { criarJob, isBusy, iniciarJob, finalizarJob } = require('../services/jobQueue');
const { emitirJobIniciado, emitirJobStep, emitirJobConcluido } = require('../ws');

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token ausente.' });
  try {
    jwt.verify(token, loadConfig().jwtSecret);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

// GET /modules — lista módulos disponíveis
router.get('/modules', (_req, res) => {
  res.json({ modules: listModules() });
});

// POST /api/run — executa um módulo
router.post('/api/run', authMiddleware, async (req, res) => {
  const { module: moduleName, payload } = req.body || {};

  if (!moduleName) {
    return res.status(400).json({ error: 'Campo "module" é obrigatório.' });
  }

  const mod = getModule(moduleName);
  if (!mod) {
    return res.status(404).json({
      error: `Módulo "${moduleName}" não encontrado.`,
      available: listModules().map(m => m.name),
    });
  }

  if (isBusy()) {
    return res.status(409).json({ error: 'Agent ocupado. Aguarde o job atual terminar ou verifique GET /jobs.' });
  }

  const job = criarJob(moduleName, payload);
  res.status(202).json({ jobId: job.id, status: 'pending' });

  // Executa em background
  setImmediate(async () => {
    const onStep = iniciarJob(job, (step) => emitirJobStep(job.id, moduleName, step.message));
    emitirJobIniciado(job);
    try {
      await mod.execute(payload || {}, onStep);
      finalizarJob(job);
    } catch (err) {
      finalizarJob(job, err.message);
    }
    emitirJobConcluido(job);
  });
});

module.exports = router;
