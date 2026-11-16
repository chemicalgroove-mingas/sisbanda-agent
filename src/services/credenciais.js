'use strict';

/**
 * Cofre das credenciais do SEAD (usuário e senha de quem usa este Agent).
 *
 * Cifra com o safeStorage do Electron, que no Windows é a DPAPI: só a mesma
 * conta do Windows, nesta máquina, consegue decifrar o arquivo. Nada de chave
 * derivada de hostname/usuário (o antigo vault.js), que qualquer processo
 * consegue recalcular.
 *
 * Regras:
 *  - a senha nunca sai daqui por resumo(): a tela recebe só "configurada";
 *  - só a automação recebe a senha (lerParaAutomacao), já registrada para
 *    redação em logs e mensagens (src/services/segredos.js);
 *  - fora do Electron (testes, `npm run server-only`) o cofre fica
 *    indisponível e a automação falha cedo, com mensagem clara.
 *
 * O desinstalador apaga este arquivo (installer/nsis-extra.nsh), exceto em
 * atualização.
 */

const fs   = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('../config');
const { registrarSegredo } = require('./segredos');

const NOME_ARQUIVO   = 'credenciais.dat';
const ARQUIVO_PADRAO = path.join(CONFIG_DIR, NOME_ARQUIVO);

const MSG_INDISPONIVEL =
  'A proteção de dados do Windows não está disponível para o Agent; as credenciais do SEAD não podem ser guardadas nem lidas.';

function criptoElectron() {
  let safeStorage = null;
  if (process.versions.electron) {
    try { ({ safeStorage } = require('electron')); } catch { safeStorage = null; }
  }
  return {
    disponivel: () => {
      try { return !!safeStorage && safeStorage.isEncryptionAvailable(); } catch { return false; }
    },
    cifrar:   (texto) => safeStorage.encryptString(texto),
    decifrar: (buf)   => safeStorage.decryptString(buf),
  };
}

/**
 * @param {object} [opcoes]
 * @param {string} [opcoes.arquivo]  caminho do arquivo cifrado
 * @param {{disponivel():boolean, cifrar(s:string):Buffer, decifrar(b:Buffer):string}} [opcoes.cripto]
 */
function criarCofre({ arquivo = ARQUIVO_PADRAO, cripto = criptoElectron() } = {}) {
  function ler() {
    if (!cripto.disponivel() || !fs.existsSync(arquivo)) return null;
    try {
      const dados = JSON.parse(cripto.decifrar(fs.readFileSync(arquivo)));
      const usuario = typeof dados?.usuario === 'string' ? dados.usuario : '';
      const senha   = typeof dados?.senha   === 'string' ? dados.senha   : '';
      if (!usuario || !senha) return null;
      registrarSegredo(senha);
      return { usuario, senha };
    } catch {
      // Arquivo de outra conta do Windows, corrompido ou adulterado.
      return null;
    }
  }

  function gravar(usuario, senha) {
    registrarSegredo(senha);
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    const tmp = `${arquivo}.tmp`;
    fs.writeFileSync(tmp, cripto.cifrar(JSON.stringify({ usuario, senha })));
    fs.renameSync(tmp, arquivo);
  }

  return {
    disponivel: () => cripto.disponivel(),

    /** O que a tela e o /status podem saber. Nunca a senha. */
    resumo() {
      const c = ler();
      return { disponivel: cripto.disponivel(), configuradas: !!c, usuario: c ? c.usuario : '' };
    },

    configuradas() { return !!ler(); },

    /**
     * Grava usuário e senha. Senha vazia com credencial já gravada = troca só
     * o usuário e mantém a senha atual.
     */
    salvar({ usuario, senha } = {}) {
      if (!cripto.disponivel()) throw new Error(MSG_INDISPONIVEL);
      const u = String(usuario ?? '').trim();
      // A senha não é aparada: espaço pode fazer parte dela.
      let s = typeof senha === 'string' ? senha : '';
      if (!u) throw new Error('Informe o usuário do SEAD.');
      if (!s) {
        const atual = ler();
        if (!atual) throw new Error('Informe a senha do SEAD.');
        s = atual.senha;
      }
      gravar(u, s);
    },

    apagar() {
      if (fs.existsSync(arquivo)) fs.unlinkSync(arquivo);
    },

    /** Só para a automação, no momento de logar no SEAD. */
    lerParaAutomacao() { return ler(); },
  };
}

let padrao = null;
function obterCofre() {
  if (!padrao) padrao = criarCofre();
  return padrao;
}

module.exports = { criarCofre, obterCofre, NOME_ARQUIVO, MSG_INDISPONIVEL };
