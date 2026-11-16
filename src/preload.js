'use strict';

// Ponte mínima entre a janela do Agent e o processo principal. Roda em sandbox,
// com contextIsolation: a página só enxerga as quatro funções abaixo, nunca o
// ipcRenderer. Os nomes dos canais espelham src/ipc.js (test/ipc.test.js confere).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sisbandaAgent', {
  lerConfiguracao:   ()        => ipcRenderer.invoke('agent:configuracao:ler'),
  salvarCredenciais: (c)       => ipcRenderer.invoke('agent:credenciais:salvar', c),
  apagarCredenciais: ()        => ipcRenderer.invoke('agent:credenciais:apagar'),
  dispararPedidoTeste: (pedido) => ipcRenderer.invoke('agent:pedido-teste:disparar', pedido),
});
