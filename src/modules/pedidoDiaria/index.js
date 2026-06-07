'use strict';

const { lancarDiarias } = require('../../automations/pedidoDiaria');

module.exports = {
  name:        'pedido-diaria',
  description: 'Pedido automático de diárias no sistema SEAD/PB',
  version:     '1.0.0',
  status:      'available',

  async execute(payload, onStep) {
    onStep('INICIANDO PEDIDO');
    onStep(`Integrantes: ${payload.integrantes?.length ?? 0}`);

    await lancarDiarias(payload, (ev) => {
      onStep(`[${ev.integrante}] ${ev.status}${ev.erro ? ' — ' + ev.erro : ''}`);
    });

    onStep('CONCLUÍDO');
  },
};
