'use strict';

const express = require('express');
const http    = require('http');
const cors    = require('cors');
const path    = require('path');
const logger  = require('./services/logger');
const { loadConfig }  = require('./config');
const { iniciarWS }   = require('./ws');
const { router: statusRouter }  = require('./routes/status');
const { router: versionRouter } = require('./routes/version');
const runRouter         = require('./routes/run');
const jobsRouter        = require('./routes/jobs');
const diagnosticsRouter = require('./routes/diagnostics');

function createApp() {
  const app = express();

  // Aceita apenas localhost
  app.use((req, res, next) => {
    const ip = req.socket.remoteAddress || '';
    if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return next();
    return res.status(403).json({ error: 'Acesso externo não permitido.' });
  });

  app.use(cors({ origin: '*' }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/', statusRouter);
  app.use('/', versionRouter);
  app.use('/', runRouter);
  app.use('/', jobsRouter);
  app.use('/', diagnosticsRouter);

  app.get('/ui', (_req, res) =>
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'))
  );

  return app;
}

function startServer(onReady) {
  const cfg    = loadConfig();
  const app    = createApp();
  const server = http.createServer(app);

  iniciarWS(server);

  server.listen(cfg.port, '127.0.0.1', () => {
    logger.info(`SISBANDA Agent v${cfg.agentVersion} — http://localhost:${cfg.port}`);
    onReady?.();
  });

  return server;
}

if (require.main === module) startServer();

module.exports = { startServer };
