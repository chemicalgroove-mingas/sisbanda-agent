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

const CANAIS = {
  LER:                'agent:configuracao:ler',
  SALVAR_PARAMETROS:  'agent:parametros:salvar',
  SALVAR_CREDENCIAIS: 'agent:credenciais:salvar',
  APAGAR_CREDENCIAIS: 'agent:credenciais:apagar',
  PEDIDO_TESTE:       'agent:pedido-teste:disparar',
};

// Campo da tela → chave do config.json.
const PARAMETROS = {
  requisitante:        'seadRequisitante',
  cidadeOrigemPadrao:  'seadCidadeOrigemPadrao',
  objetivo:            'seadObjetivo',
  justificativaPadrao: 'seadJustificativa',
};
const TAMANHO_MAXIMO = 4000;

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

function lerParametros(config) {
  const r = {};
  for (const [campo, chave] of Object.entries(PARAMETROS)) r[campo] = String(config[chave] ?? '');
  return r;
}

/**
 * @param {object} d
 * @param {{handle(canal:string, fn:Function):void}} d.ipcMain
 * @param {() => object|null} d.janela       BrowserWindow do Agent
 * @param {() => string}      d.origemUi     ex.: http://localhost:9876
 * @param {object}            d.cofre        src/services/credenciais.js
 * @param {() => object}      d.lerConfig
 * @param {(parcial:object) => void} d.atualizarConfig
 * @param {(modulo:string, payload:object) => {status:number, body:object}} d.enfileirar
 */
function registrarIpc({ ipcMain, janela, origemUi, cofre, lerConfig, atualizarConfig, enfileirar }) {
  function estado() {
    return { credenciais: cofre.resumo(), parametros: lerParametros(lerConfig()) };
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

  tratar(CANAIS.SALVAR_PARAMETROS, (p) => {
    if (!p || typeof p !== 'object') throw new Error('Parâmetros inválidos.');
    const parcial = {};
    for (const [campo, chave] of Object.entries(PARAMETROS)) {
      if (!(campo in p)) continue;
      if (typeof p[campo] !== 'string') throw new Error(`Campo ${campo} deve ser texto.`);
      const v = p[campo].trim();
      if (v.length > TAMANHO_MAXIMO) throw new Error(`Campo ${campo} longo demais.`);
      parcial[chave] = v;
    }
    atualizarConfig(parcial);
    return estado();
  });

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

module.exports = { registrarIpc, remetenteValido, CANAIS, PARAMETROS };
