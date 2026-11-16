'use strict';

// Cada camada de proteção da senha testada sozinha: as camadas se sobrepõem de
// propósito, e sem isto a falha de uma ficaria escondida pela outra.

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sisbanda-agent-camadas-'));
process.env.USERPROFILE = HOME;
process.env.HOME = HOME;
const CFG_DIR = path.join(HOME, 'AppData', 'Roaming', 'SisbandaAgent');
fs.mkdirSync(CFG_DIR, { recursive: true });
// config.json "de versão antiga" com credencial em texto puro.
fs.writeFileSync(path.join(CFG_DIR, 'config.json'), JSON.stringify({
  port: 0, seadUsuario: 'velho.usuario', seadSenha: 'velha-senha-texto-puro',
}));
// Variáveis de ambiente que versões antigas liam.
process.env.SEAD_USUARIO = 'usuario-do-ambiente';
process.env.SEAD_SENHA   = 'senha-do-ambiente';
process.env.SEAD_REQUISITANTE = 'REQUISITANTE DO AMBIENTE';

const winston = require('winston');
const logger = require('../src/services/logger');
const { registrarSegredo, MARCA, _limparRegistro } = require('../src/services/segredos');
const { criarJob, iniciarJob, finalizarJob } = require('../src/services/jobQueue');
const { enfileirar } = require('../src/services/executor');
const { listJobs } = require('../src/services/jobQueue');
const { loadConfig, atualizarConfig } = require('../src/config');
const { lancarDiarias } = require('../src/automations/pedidoDiaria');
const { criarCofre, NOME_ARQUIVO } = require('../src/services/credenciais');

const SENHA = 'camada-senha-777';

const linhas = [];
class Captura extends winston.Transport {
  log(info, cb) { linhas.push(info[Symbol.for('message')]); cb(); }
}
logger.add(new Captura());

test.after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch {} });

test('logger: mensagem com a senha registrada sai redigida', () => {
  _limparRegistro();
  registrarSegredo(SENHA);
  logger.info(`teste do logger ${SENHA}`);
  const ultima = linhas[linhas.length - 1];
  assert.match(ultima, new RegExp(`teste do logger \\${MARCA.slice(0, -1)}\\]`));
  assert.equal(ultima.includes(SENHA), false);
});

test('fila: passo e erro do job saem redigidos', () => {
  _limparRegistro();
  registrarSegredo(SENHA);
  const job = criarJob('x', {});
  const vistos = [];
  const onStep = iniciarJob(job, s => vistos.push(s.message));
  onStep(`passo com ${SENHA}`);
  finalizarJob(job, `erro com ${SENHA}`);
  assert.equal(job.steps[0].message, `passo com ${MARCA}`);
  assert.equal(vistos[0], `passo com ${MARCA}`);
  assert.equal(job.error, `erro com ${MARCA}`);
});

test('automação: eventos de status saem redigidos antes de chegar à fila', async () => {
  const cripto = {
    disponivel: () => true,
    cifrar: s => Buffer.from(Buffer.from(s).toString('base64')),
    decifrar: b => Buffer.from(b.toString(), 'base64').toString(),
  };
  const cofre = criarCofre({ arquivo: path.join(HOME, 'c.dat'), cripto });
  cofre.salvar({ usuario: 'u.teste', senha: SENHA });
  _limparRegistro();
  const page = {
    goto: async () => {}, waitForLoadState: async () => {},
    fill: async (sel, v) => { if (sel.includes('password')) throw new Error(`eco ${v}`); },
    $$: async () => [],
  };
  const browser = { newContext: async () => ({ newPage: async () => page }), on: () => {}, close: async () => {} };
  const eventos = [];
  await lancarDiarias({
    tipoViagem: 'estadual', destinoUF: 'PB', destinoCidade: 'Campina Grande',
    dataSaida: '2026-11-23T08:00', dataRetorno: '2026-11-23T18:00',
    integrantes: [{ nome: 'FULANO' }],
  }, ev => eventos.push(ev), {
    cofre, config: { seadRequisitante: 'R' }, lancar: async () => ({ browser }), esperar: async () => {},
  });
  const erro = eventos.find(e => e.status === 'erro');
  assert.ok(erro);
  assert.equal(erro.erro, `eco ${MARCA}`);
});

test('executor: payload fora do contrato → 400 sem criar job', () => {
  const antes = listJobs().length;
  const r = enfileirar('pedido-diaria', { tipoViagem: 'estadual' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Payload inválido.');
  assert.ok(r.body.detalhes.length > 0);
  assert.equal(listJobs().length, antes);
});

test('config: seadUsuario/seadSenha de config.json antigo e variáveis SEAD_* são ignorados', () => {
  const cfg = loadConfig();
  assert.equal('seadUsuario' in cfg, false);
  assert.equal('seadSenha' in cfg, false);
  assert.equal(cfg.seadRequisitante, '');            // sem nome padrão, sem ambiente
  assert.equal(JSON.stringify(cfg).includes('ambiente'), false);
  // atualizarConfig não regrava credencial vinda da tela.
  atualizarConfig({ seadSenha: 'nova', seadRequisitante: 'X' });
  assert.equal(loadConfig().seadSenha, undefined);
});

test('código-fonte: nenhuma leitura de SEAD_USUARIO/SEAD_SENHA/SEAD_REQUISITANTE nem nome padrão', () => {
  const arquivos = [];
  (function varrer(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) varrer(p); else if (p.endsWith('.js')) arquivos.push(p);
    }
  })(path.join(__dirname, '..', 'src'));
  for (const f of arquivos) {
    const src = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /SEAD_USUARIO|SEAD_SENHA|SEAD_REQUISITANTE|MAISA/, f);
  }
});

test('desinstalador apaga credenciais.dat só fora de atualização', () => {
  const nsh = fs.readFileSync(path.join(__dirname, '..', 'installer', 'nsis-extra.nsh'), 'utf8');
  const bloco = /\$\{ifNot\} \$\{isUpdated\}([\s\S]*?)\$\{endIf\}/.exec(nsh);
  assert.ok(bloco, 'bloco ${ifNot} ${isUpdated} ausente');
  assert.ok(bloco[1].includes(`Delete "$APPDATA\\SisbandaAgent\\${NOME_ARQUIVO}"`));
  const fora = nsh.replace(bloco[0], '');
  assert.equal(fora.includes('Delete '), false, 'nenhum Delete fora do bloco de não-atualização');
  assert.doesNotMatch(nsh, /Delete[^\n]*config\.json|RMDir/);  // config e logs ficam
});
