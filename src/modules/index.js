'use strict';

/**
 * Registro central de módulos do SISBANDA Agent.
 * Para adicionar um novo módulo: criar src/modules/<nome>/index.js
 * e registrá-lo aqui.
 */

const modules = {
  'pedido-diaria': require('./pedidoDiaria'),

  // Futuros módulos:
  // 'assinatura-digital': require('./assinaturaDigital'),
  // 'scanner':            require('./scanner'),
  // 'impressao':          require('./impressao'),
  // 'oficio':             require('./oficio'),
};

function getModule(name) { return modules[name] || null; }
function listModules()   { return Object.values(modules).map(m => ({ name: m.name, description: m.description, version: m.version, status: m.status })); }

module.exports = { getModule, listModules };
