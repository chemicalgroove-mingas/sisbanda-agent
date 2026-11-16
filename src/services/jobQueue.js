'use strict';

const { randomUUID } = require('crypto');
const logger = require('./logger');
const { redigir } = require('./segredos');

const MAX_JOBS = 100;
const jobs = [];

function criarJob(module, payload) {
  const job = {
    id:          randomUUID(),
    module,
    status:      'pending',   // pending | running | done | error
    payload,
    steps:       [],
    error:       null,
    startedAt:   null,
    finishedAt:  null,
    createdAt:   new Date().toISOString(),
  };
  jobs.unshift(job);
  if (jobs.length > MAX_JOBS) jobs.splice(MAX_JOBS);
  return job;
}

function getJob(id)    { return jobs.find(j => j.id === id) || null; }
function listJobs()    { return [...jobs]; }
// `pending` também conta: entre criar o job e começar a rodá-lo há um setImmediate.
function isBusy()      { return jobs.some(j => j.status === 'running' || j.status === 'pending'); }

function iniciarJob(job, onStep) {
  job.status    = 'running';
  job.startedAt = new Date().toISOString();
  logger.info(`[job:${job.id}] INICIADO — módulo: ${job.module}`);

  // Passo e erro saem daqui para o log, para GET /jobs/:id e para o WebSocket:
  // são redigidos na origem.
  job._onStep = (msg) => {
    const step = { message: redigir(msg), ts: new Date().toISOString() };
    job.steps.push(step);
    logger.info(`[job:${job.id}] ${step.message}`);
    onStep?.(step);
  };
  return job._onStep;
}

function finalizarJob(job, erro = null) {
  job.status     = erro ? 'error' : 'done';
  job.error      = erro ? redigir(erro) : null;
  job.finishedAt = new Date().toISOString();
  logger.info(`[job:${job.id}] ${erro ? 'ERRO — ' + job.error : 'CONCLUÍDO'}`);
}

module.exports = { criarJob, getJob, listJobs, isBusy, iniciarJob, finalizarJob };
