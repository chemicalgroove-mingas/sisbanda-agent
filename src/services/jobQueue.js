'use strict';

const { randomUUID } = require('crypto');
const logger = require('./logger');

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
function isBusy()      { return jobs.some(j => j.status === 'running'); }

function iniciarJob(job, onStep) {
  job.status    = 'running';
  job.startedAt = new Date().toISOString();
  logger.info(`[job:${job.id}] INICIADO — módulo: ${job.module}`);

  job._onStep = (msg) => {
    const step = { message: msg, ts: new Date().toISOString() };
    job.steps.push(step);
    logger.info(`[job:${job.id}] ${msg}`);
    onStep?.(step);
  };
  return job._onStep;
}

function finalizarJob(job, erro = null) {
  job.status     = erro ? 'error' : 'done';
  job.error      = erro;
  job.finishedAt = new Date().toISOString();
  logger.info(`[job:${job.id}] ${erro ? 'ERRO — ' + erro : 'CONCLUÍDO'}`);
}

module.exports = { criarJob, getJob, listJobs, isBusy, iniciarJob, finalizarJob };
