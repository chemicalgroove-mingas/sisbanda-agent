'use strict';

const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const { loadConfig, tokenExigido } = require('../config');
const { listModules } = require('../modules');
const { enfileirar }  = require('../services/executor');

// A barreira de origem (src/services/origem.js) roda antes, no app inteiro:
// exigirToken = false NÃO a desliga.
function authMiddleware(req, res, next) {
  const cfg = loadConfig();
  if (!tokenExigido(cfg)) return next();
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token ausente.' });
  try {
    jwt.verify(token, cfg.jwtSecret);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

// GET /modules — lista módulos disponíveis
router.get('/modules', (_req, res) => {
  res.json({ modules: listModules() });
});

// POST /api/run — executa um módulo (contrato do pedido-diaria em
// docs/contrato-pedido-diaria.md)
router.post('/api/run', authMiddleware, (req, res) => {
  const { module: moduleName, payload } = req.body || {};
  const r = enfileirar(moduleName, payload);
  res.status(r.status).json(r.body);
});

module.exports = router;
