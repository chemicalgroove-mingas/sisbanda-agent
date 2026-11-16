'use strict';

// Inicialização com o Windows: valor em HKCU\Software\Microsoft\Windows\CurrentVersion\Run.
// Nome fixo (o mesmo do installer/setup.iss e do installer/nsis-extra.nsh) para o
// desinstalador saber o que remover. Quando o Windows abre o Agent, ele sobe só na
// bandeja, sem janela.
const NOME_INICIALIZACAO = 'SisbandaAgent';
const ARG_OCULTO         = '--oculto';

// Opções para app.setLoginItemSettings.
//
// O Electron grava o valor do Run como `${path} ${args}`, sem aspas. A pasta de
// instalação padrão tem espaço ("...\Programs\SISBANDA Agent\SISBANDA Agent.exe"),
// e sem aspas o Windows tem de adivinhar onde o executável termina: tentaria antes
// "...\Programs\SISBANDA" e só depois o caminho certo. Por isso o caminho vai
// entre aspas aqui.
function opcoesInicioComWindows(ativo, execPath) {
  return {
    openAtLogin: ativo,
    name: NOME_INICIALIZACAO,
    path: `"${execPath}"`,
    args: [ARG_OCULTO],
  };
}

module.exports = { NOME_INICIALIZACAO, ARG_OCULTO, opcoesInicioComWindows };
