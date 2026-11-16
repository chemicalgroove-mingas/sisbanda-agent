'use strict';

const { WebSocketServer } = require('ws');
const logger = require('../services/logger');

let wss = null;
const clients = new Set();

function iniciarWS(httpServer) {
  wss = new WebSocketServer({ server: httpServer });

  // O ws repassa aqui os erros do servidor HTTP (ex.: EADDRINUSE). Sem este
  // ouvinte, o erro vira exceção não tratada; quem trata é startServer().
  wss.on('error', () => {});

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress || '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) {
      ws.close(1008, 'Forbidden');
      return;
    }

    clients.add(ws);
    enviar(ws, { event: 'connected', message: 'SISBANDA Agent conectado.' });

    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  logger.info('WebSocket iniciado em ws://localhost:9876');
}

function enviar(ws, data) {
  try {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
  } catch {}
}

function broadcast(data) {
  for (const ws of clients) enviar(ws, data);
}

function emitirJobStep(jobId, module, message) {
  broadcast({ event: 'step', jobId, module, message, ts: new Date().toISOString() });
}

function emitirJobIniciado(job) {
  broadcast({ event: 'job_started', jobId: job.id, module: job.module, ts: new Date().toISOString() });
}

function emitirJobConcluido(job) {
  broadcast({
    event:  job.status === 'error' ? 'job_error' : 'job_finished',
    jobId:  job.id,
    module: job.module,
    error:  job.error || null,
    ts:     new Date().toISOString(),
  });
}

module.exports = { iniciarWS, broadcast, emitirJobStep, emitirJobIniciado, emitirJobConcluido };
