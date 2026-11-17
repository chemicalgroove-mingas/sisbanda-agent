'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const CONFIG_DIR  = path.join(os.homedir(), 'AppData', 'Roaming', 'SisbandaAgent');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Origens que podem falar com o Agent pelo navegador, além da própria UI do
// Agent (que entra sempre; ver src/services/origem.js).
const ORIGENS_PADRAO = [
  'https://pcpb.sisbanda.com.br',
  'http://localhost:3000',
];

// A versão NÃO mora aqui: vem do package.json (src/versao.js).
//
// Credenciais do SEAD NÃO moram aqui: ficam no cofre (src/services/credenciais.js),
// cifradas pelo Windows. Nem o config.json nem variáveis de ambiente fornecem
// usuário ou senha do SEAD.
//
// Parâmetros do pedido (requisitante, objetivo, justificativa, cidade de origem)
// também NÃO moram aqui: vêm do site no payload (docs/contrato-pedido-diaria.md).
const DEFAULT_JWT_SECRET = 'sisbanda-agent-secret';
const DEFAULTS = {
  port:           9876,
  // exigirToken: só o booleano false desliga a conferência do token em /api/run
  // (ver tokenExigido). Existe para testar nesta máquina antes de o backend
  // assinar com AGENT_JWT_SECRET. Padrão seguro: exige.
  exigirToken:    true,
  iniciarComWindows: true,
  allowedOrigins: ORIGENS_PADRAO,
  jwtSecret:     process.env.AGENT_JWT_SECRET || DEFAULT_JWT_SECRET,
  janelaSequencial: process.env.SEAD_JANELAS_SEQUENCIAIS === '1',
};

// Chaves de versões antigas que nunca devem ser lidas do config.json.
// seadUsuario/seadSenha: credenciais em texto puro, agora só no cofre.
// seadRequisitante/seadObjetivo/seadJustificativa/seadCidadeOrigemPadrao: da
// versão 1.1.0; agora vêm do site. Se ficaram no arquivo, são ignoradas.
const CHAVES_IGNORADAS = [
  'agentVersion', 'seadUsuario', 'seadSenha',
  'seadRequisitante', 'seadObjetivo', 'seadJustificativa', 'seadCidadeOrigemPadrao',
];

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

function semIgnoradas(obj) {
  const limpo = { ...obj };
  for (const k of CHAVES_IGNORADAS) delete limpo[k];
  return limpo;
}

function loadConfig() {
  ensureConfigDir();
  // config.json de versões antigas pode trazer "agentVersion" (ignorado, para que
  // a versão informada seja sempre a do executável) e seadUsuario/seadSenha
  // (ignorados: credencial só vem do cofre).
  return { ...DEFAULTS, ...semIgnoradas(lerSalvo()) };
}

// Qualquer valor que não seja exatamente false (ausente, "false", 0, null)
// mantém a exigência: nada sai inseguro por engano de digitação.
function tokenExigido(cfg = loadConfig()) {
  return cfg.exigirToken !== false;
}

function saveConfig(cfg) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(semIgnoradas(cfg), null, 2), 'utf8');
}

// Grava só as chaves alteradas, sem congelar os DEFAULTS no arquivo do usuário.
function atualizarConfig(parcial) {
  ensureConfigDir();
  const novo = { ...lerSalvo(), ...semIgnoradas(parcial) };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(novo, null, 2), 'utf8');
  return novo;
}

module.exports = { loadConfig, tokenExigido, saveConfig, atualizarConfig, CONFIG_DIR, DEFAULTS, ORIGENS_PADRAO, DEFAULT_JWT_SECRET };
