'use strict';

const { WebSocketServer } = require('ws');
const logger = require('../services/logger');

const IPS_LOCAIS = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

let wss = null;
const clients = new Set();

// `barreira` (src/services/origem.js) recusa o handshake de origem estranha com
// 403, antes de a conexão existir: a página nem chega a receber o "connected".
function iniciarWS(httpServer, barreira) {
  wss = new WebSocketServer({
    server: httpServer,
    verifyClient: (info, cb) => {
      const ip = info.req.socket.remoteAddress || '';
      if (!IPS_LOCAIS.includes(ip)) return cb(false, 403, 'Acesso externo não permitido.');
      return barreira.verificarWs(info, cb);
    },
  });

  // O ws repassa aqui os erros do servidor HTTP (ex.: EADDRINUSE). Sem este
  // ouvinte, o erro vira exceção não tratada; quem trata é startServer().
  wss.on('error', () => {});

  wss.on('connection', (ws) => {
    clients.add(ws);
    enviar(ws, { event: 'connected', message: 'SISBANDA Agent conectado.' });

    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  logger.info('WebSocket iniciado.');
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
