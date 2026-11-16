'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const { opcoesInicioComWindows, NOME_INICIALIZACAO, ARG_OCULTO } = require('../src/inicializacao');

// Reproduz o que o Electron grava no Run (shell/browser/browser_win.cc,
// FormatCommandLineString): caminho e argumentos separados por espaço, sem aspas.
function valorDoRun({ path, args }) {
  return [path, ...args].join(' ');
}

const EXE = 'C:\\Users\\fulano\\AppData\\Local\\Programs\\SISBANDA Agent\\SISBANDA Agent.exe';

test('valor do Run traz o executável entre aspas, mesmo com espaço no caminho', () => {
  const valor = valorDoRun(opcoesInicioComWindows(true, EXE));
  assert.equal(valor, `"${EXE}" --oculto`);
});

test('nome do valor e argumento são os que o desinstalador e o main.js esperam', () => {
  const o = opcoesInicioComWindows(false, EXE);
  assert.equal(NOME_INICIALIZACAO, 'SisbandaAgent');   // installer/nsis-extra.nsh apaga por este nome
  assert.equal(o.name, NOME_INICIALIZACAO);
  assert.deepEqual(o.args, [ARG_OCULTO]);
  assert.equal(o.openAtLogin, false);
  assert.equal(opcoesInicioComWindows(true, EXE).openAtLogin, true);
});
