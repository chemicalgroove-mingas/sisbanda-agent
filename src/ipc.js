'use strict';

/**
 * Canal da janela do Agent com o processo principal.
 *
 * Configuração das credenciais e o "Pedido de teste" passam SÓ por aqui: não
 * existe rota HTTP para salvar ou ler credencial nem para disparar o teste.
 * Cada chamada confere que veio do frame principal da janela do Agent, com a
 * página da UI do próprio Agent carregada.
 *
 * Os nomes dos canais estão repetidos em src/preload.js (o preload roda em
 * sandbox e não pode importar este arquivo); test/ipc.test.js garante que batem.
 */

const { redigir } = require('./services/segredos');

// A configuração do Agent é só usuário e senha do SEAD. Parâmetros do pedido
// (requisitante, objetivo, justificativa, cidade de origem) vêm do site.
const CANAIS = {
  LER:                'agent:configuracao:ler',
  SALVAR_CREDENCIAIS: 'agent:credenciais:salvar',
  APAGAR_CREDENCIAIS: 'agent:credenciais:apagar',
  PEDIDO_TESTE:       'agent:pedido-teste:disparar',
};

function remetenteValido(event, janela, origemUi) {
  try {
    if (!janela || (janela.isDestroyed && janela.isDestroyed())) return false;
    if (!event || event.sender !== janela.webContents) return false;
    const frame = event.senderFrame;
    if (!frame || frame.parent) return false;          // só o frame principal
    return new URL(frame.url).origin === origemUi;
  } catch {
    return false;
  }
}

/**
 * @param {object} d
 * @param {{handle(canal:string, fn:Function):void}} d.ipcMain
 * @param {() => object|null} d.janela       BrowserWindow do Agent
 * @param {() => string}      d.origemUi     ex.: http://localhost:9876
 * @param {object}            d.cofre        src/services/credenciais.js
 * @param {(modulo:string, payload:object) => {status:number, body:object}} d.enfileirar
 */
function registrarIpc({ ipcMain, janela, origemUi, cofre, enfileirar }) {
  function estado() {
    return { credenciais: cofre.resumo() };
  }

  function tratar(canal, fn) {
    ipcMain.handle(canal, async (event, arg) => {
      if (!remetenteValido(event, janela(), origemUi())) {
        return { ok: false, erro: 'Remetente não autorizado.' };
      }
      try {
        return { ok: true, ...(await fn(arg)) };
      } catch (err) {
        return { ok: false, erro: redigir(err?.message || String(err)) };
      }
    });
  }

  tratar(CANAIS.LER, () => estado());

  tratar(CANAIS.SALVAR_CREDENCIAIS, (c) => {
    if (!c || typeof c !== 'object') throw new Error('Credenciais inválidas.');
    cofre.salvar({ usuario: c.usuario, senha: c.senha });
    return estado();
  });

  tratar(CANAIS.APAGAR_CREDENCIAIS, () => {
    cofre.apagar();
    return estado();
  });

  tratar(CANAIS.PEDIDO_TESTE, (payload) => {
    const r = enfileirar('pedido-diaria', payload);
    if (r.status !== 202) {
      const detalhes = Array.isArray(r.body.detalhes) ? ` ${r.body.detalhes.join(' ')}` : '';
      throw new Error(`${r.body.error}${detalhes}`);
    }
    return { jobId: r.body.jobId };
  });
}

module.exports = { registrarIpc, remetenteValido, CANAIS };
