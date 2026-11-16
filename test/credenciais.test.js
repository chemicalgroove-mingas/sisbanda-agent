'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sisbanda-agent-cofre-'));
process.env.USERPROFILE = HOME;
process.env.HOME = HOME;

const { criarCofre, MSG_INDISPONIVEL } = require('../src/services/credenciais');
const { redigir, registrarSegredo, MARCA, _limparRegistro } = require('../src/services/segredos');

const SENHA   = 'S3nh@-Secreta"\\ço';
const USUARIO = 'usuario.teste';

// Dublê do safeStorage: cifra de verdade não interessa aqui, só que o arquivo
// não carregue o texto puro e que decifrar devolva o que foi cifrado.
function criptoFalsa({ disponivel = true } = {}) {
  return {
    disponivel: () => disponivel,
    cifrar:   (s) => Buffer.from('CIFRA:' + Buffer.from(s, 'utf8').toString('base64')),
    decifrar: (b) => {
      const t = b.toString();
      if (!t.startsWith('CIFRA:')) throw new Error('não decifra');
      return Buffer.from(t.slice(6), 'base64').toString('utf8');
    },
  };
}

let n = 0;
function arquivoNovo() { return path.join(HOME, `cred-${n++}.dat`); }

test.afterEach(() => _limparRegistro());
test.after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch {} });

test('salva e lê para a automação; o arquivo não contém usuário nem senha em texto puro', () => {
  const arquivo = arquivoNovo();
  const cofre = criarCofre({ arquivo, cripto: criptoFalsa() });
  assert.equal(cofre.configuradas(), false);
  cofre.salvar({ usuario: `  ${USUARIO}  `, senha: SENHA });
  assert.equal(cofre.configuradas(), true);
  assert.deepEqual(cofre.lerParaAutomacao(), { usuario: USUARIO, senha: SENHA });
  const bruto = fs.readFileSync(arquivo).toString('latin1');
  assert.equal(bruto.includes(SENHA), false);
  assert.equal(bruto.includes(USUARIO), false);
  assert.equal(fs.existsSync(`${arquivo}.tmp`), false);
});

test('resumo() nunca devolve a senha', () => {
  const cofre = criarCofre({ arquivo: arquivoNovo(), cripto: criptoFalsa() });
  cofre.salvar({ usuario: USUARIO, senha: SENHA });
  const r = cofre.resumo();
  assert.deepEqual(r, { disponivel: true, configuradas: true, usuario: USUARIO });
  assert.equal(JSON.stringify(r).includes(SENHA), false);
});

test('senha em branco com credencial gravada troca só o usuário; sem credencial, exige senha', () => {
  const cofre = criarCofre({ arquivo: arquivoNovo(), cripto: criptoFalsa() });
  assert.throws(() => cofre.salvar({ usuario: USUARIO, senha: '' }), /Informe a senha/);
  assert.throws(() => cofre.salvar({ usuario: '  ', senha: SENHA }), /Informe o usuário/);
  cofre.salvar({ usuario: USUARIO, senha: SENHA });
  cofre.salvar({ usuario: 'outro.usuario', senha: '' });
  assert.deepEqual(cofre.lerParaAutomacao(), { usuario: 'outro.usuario', senha: SENHA });
});

test('apagar remove o arquivo e volta a "não configurada"', () => {
  const arquivo = arquivoNovo();
  const cofre = criarCofre({ arquivo, cripto: criptoFalsa() });
  cofre.salvar({ usuario: USUARIO, senha: SENHA });
  cofre.apagar();
  assert.equal(fs.existsSync(arquivo), false);
  assert.equal(cofre.configuradas(), false);
  assert.equal(cofre.lerParaAutomacao(), null);
  cofre.apagar(); // idempotente
});

test('sem safeStorage (fora do Electron): não grava, não lê, mensagem clara', () => {
  const arquivo = arquivoNovo();
  const cofre = criarCofre({ arquivo, cripto: criptoFalsa({ disponivel: false }) });
  assert.throws(() => cofre.salvar({ usuario: USUARIO, senha: SENHA }), { message: MSG_INDISPONIVEL });
  assert.equal(fs.existsSync(arquivo), false);
  assert.equal(cofre.configuradas(), false);
  assert.equal(cofre.resumo().disponivel, false);
});

test('fora do Electron o cofre padrão fica indisponível (sem chave caseira de reserva)', () => {
  const cofre = criarCofre({ arquivo: arquivoNovo() });
  assert.equal(process.versions.electron, undefined);
  assert.equal(cofre.disponivel(), false);
  assert.throws(() => cofre.salvar({ usuario: USUARIO, senha: SENHA }), { message: MSG_INDISPONIVEL });
});

test('arquivo adulterado ou de outra conta → tratado como não configurado', () => {
  const arquivo = arquivoNovo();
  fs.writeFileSync(arquivo, 'lixo');
  const cofre = criarCofre({ arquivo, cripto: criptoFalsa() });
  assert.equal(cofre.configuradas(), false);
  assert.equal(cofre.lerParaAutomacao(), null);
});

test('ler a credencial registra a senha para redação', () => {
  const arquivo = arquivoNovo();
  criarCofre({ arquivo, cripto: criptoFalsa() }).salvar({ usuario: USUARIO, senha: SENHA });
  _limparRegistro();                                   // processo "novo"
  assert.equal(redigir(`x ${SENHA} y`).includes(SENHA), true);
  criarCofre({ arquivo, cripto: criptoFalsa() }).lerParaAutomacao();
  assert.equal(redigir(`x ${SENHA} y`), `x ${MARCA} y`);
});

test('redigir cobre a forma escapada em JSON e em URL; ignora valores curtos', () => {
  registrarSegredo(SENHA);
  const json = JSON.stringify({ erro: `falhou com ${SENHA}` });
  assert.equal(redigir(json).includes(JSON.stringify(SENHA).slice(1, -1)), false);
  assert.equal(redigir(`?p=${encodeURIComponent(SENHA)}`).includes(encodeURIComponent(SENHA)), false);
  registrarSegredo('123');
  assert.equal(redigir('2026-11-23'), '2026-11-23');
  assert.equal(redigir(null), null);
});
