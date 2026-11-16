'use strict';

/**
 * Porta única de entrada da fila de jobs. O POST /api/run (site) e o "Pedido
 * de teste" da janela do Agent (IPC) passam pelos mesmos passos: módulo
 * existe → Agent livre → payload válido pelo contrato do módulo → job.
 */

const { getModule, listModules } = require('../modules');
const { criarJob, isBusy, iniciarJob, finalizarJob } = require('./jobQueue');
const { emitirJobIniciado, emitirJobStep, emitirJobConcluido } = require('../ws');

/**
 * @param {string} moduleName
 * @param {object} payload
 * @param {object} [deps]  só para testes: { getModule }
 * @returns {{ status: number, body: object }}  status HTTP equivalente e corpo
 */
function enfileirar(moduleName, payload, { getModule: buscarModulo = getModule } = {}) {
  if (!moduleName) {
    return { status: 400, body: { error: 'Campo "module" é obrigatório.' } };
  }

  const mod = buscarModulo(moduleName);
  if (!mod) {
    return {
      status: 404,
      body: {
        error: `Módulo "${moduleName}" não encontrado.`,
        available: listModules().map(m => m.name),
      },
    };
  }

  if (isBusy()) {
    return { status: 409, body: { error: 'Agent ocupado. Aguarde o job atual terminar ou verifique GET /jobs.' } };
  }

  if (typeof mod.validar === 'function') {
    const v = mod.validar(payload);
    if (!v.ok) return { status: 400, body: { error: 'Payload inválido.', detalhes: v.erros } };
    payload = v.valor;
  }

  const job = criarJob(moduleName, payload);

  setImmediate(async () => {
    const onStep = iniciarJob(job, (step) => emitirJobStep(job.id, moduleName, step.message));
    emitirJobIniciado(job);
    try {
      await mod.execute(payload || {}, onStep);
      finalizarJob(job);
    } catch (err) {
      finalizarJob(job, err?.message || String(err));
    }
    emitirJobConcluido(job);
  });

  return { status: 202, body: { jobId: job.id, status: 'pending' } };
}

module.exports = { enfileirar };
