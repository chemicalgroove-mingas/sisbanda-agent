'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const CONFIG_DIR  = path.join(os.homedir(), 'AppData', 'Roaming', 'SisbandaAgent');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// A versão NÃO mora aqui: vem do package.json (src/versao.js).
const DEFAULTS = {
  port:           9876,
  iniciarComWindows: true,
  jwtSecret:     process.env.AGENT_JWT_SECRET || 'sisbanda-agent-secret',
  seadUsuario:    process.env.SEAD_USUARIO     || '',
  seadSenha:      process.env.SEAD_SENHA       || '',
  seadRequisitante: process.env.SEAD_REQUISITANTE || 'MAISA FELIX RIBEIRO DE ARAUJO',
  seadObjetivo:   process.env.SEAD_OBJETIVO_DIARIA || 'PARTICIPAR DE EVENTO',
  seadJustificativa: process.env.SEAD_JUSTIFICATIVA ||
    'Apresentação da Banda de Música da Polícia Civil do Estado da Paraíba em evento institucional, conforme informações constantes nos documentos anexos.',
  janelaSequencial: process.env.SEAD_JANELAS_SEQUENCIAIS === '1',
};

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  ['logs', 'screenshots'].forEach(sub => {
    const d = path.join(CONFIG_DIR, sub);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

// Só o que o usuário gravou, sem os DEFAULTS.
function lerSalvo() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function loadConfig() {
  ensureConfigDir();
  // config.json de versões antigas pode trazer "agentVersion": é ignorado,
  // para que a versão informada seja sempre a do executável instalado.
  const { agentVersion: _ignorada, ...saved } = lerSalvo();
  return { ...DEFAULTS, ...saved };
}

function saveConfig(cfg) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

// Grava só as chaves alteradas, sem congelar os DEFAULTS no arquivo do usuário.
function atualizarConfig(parcial) {
  ensureConfigDir();
  const novo = { ...lerSalvo(), ...parcial };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(novo, null, 2), 'utf8');
  return novo;
}

module.exports = { loadConfig, saveConfig, atualizarConfig, CONFIG_DIR, DEFAULTS };
