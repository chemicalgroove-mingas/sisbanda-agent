'use strict';

const { lancarDiarias } = require('../../automations/pedidoDiaria');
const { validarPedido } = require('./contrato');

function descreverEvento(ev) {
  let s = `[${ev.integrante}] ${ev.status}`;
  if (ev.detalhe) s += ` — ${ev.detalhe}`;
  if (ev.erro)    s += ` — ${ev.erro}`;
  return s;
}

module.exports = {
  name:        'pedido-diaria',
  description: 'Pedido automático de diárias no sistema SEAD/PB',
  version:     '1.2.0',
  status:      'available',

  // Contrato: docs/contrato-pedido-diaria.md. O executor valida antes de criar o job.
  validar: validarPedido,

  async execute(payload, onStep, deps) {
    onStep('INICIANDO PEDIDO');
    onStep(`Integrantes: ${payload.integrantes?.length ?? 0}`);

    const r = await lancarDiarias(payload, (ev) => onStep(descreverEvento(ev)), deps);

    if (r.comErro) throw new Error(`${r.comErro} de ${r.total} integrante(s) com erro. Veja os passos acima.`);
    onStep('CONCLUÍDO');
  },
};
