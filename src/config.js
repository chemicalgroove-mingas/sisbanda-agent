'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const CONFIG_DIR  = path.join(os.homedir(), 'AppData', 'Roaming', 'SisbandaAgent');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  port:           9876,
  agentVersion:   '1.0.0',
  jwtSecret:      process.env.AGENT_JWT_SECRET || 'sisbanda-agent-secret',
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

function loadConfig() {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULTS };
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveConfig(cfg) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

module.exports = { loadConfig, saveConfig, CONFIG_DIR, DEFAULTS };
