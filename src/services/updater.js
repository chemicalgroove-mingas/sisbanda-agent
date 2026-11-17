'use strict';

const https  = require('https');
const logger = require('./logger');
const { loadConfig } = require('../config');
const { VERSION }    = require('../versao');

// O backend do site publica a versão corrente do Agent:
//   GET /api/agent/info → { version, protocol, download }
// "download" é um caminho relativo ao backend (/api/agent/download, que
// redireciona para a Release do GitHub). config.json pode trocar a URL (updateUrl).
const URL_INFO_PADRAO = 'https://sisbanda-backend.onrender.com/api/agent/info';

let updateInfo = null; // { version, downloadUrl, mandatory, available, checked }

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 8000 }, res => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('Resposta inválida')); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));
  });
}

function semver(v) {
  return String(v || '0').split('.').map(n => parseInt(n, 10) || 0);
}

function maisNovo(remote, local) {
  const [rMaj, rMin, rPat] = semver(remote);
  const [lMaj, lMin, lPat] = semver(local);
  if (rMaj !== lMaj) return rMaj > lMaj;
  if (rMin !== lMin) return rMin > lMin;
  return rPat > lPat;
}

// Endereço absoluto do instalador. Aceita "download" (formato do backend,
// relativo ou absoluto) e "downloadUrl" (formato antigo).
function enderecoDownload(remote, urlInfo) {
  const bruto = remote.download || remote.downloadUrl;
  if (!bruto || typeof bruto !== 'string') return '';
  try { return new URL(bruto, urlInfo).href; } catch { return ''; }
}

/**
 * @param {object} [deps] só para testes: { buscar, versaoLocal }
 */
async function verificarAtualizacao({ buscar = fetchJson, versaoLocal = VERSION } = {}) {
  const cfg = loadConfig();
  const url = cfg.updateUrl || URL_INFO_PADRAO;
  try {
    const remote = await buscar(url);
    if (!remote || typeof remote.version !== 'string') throw new Error('Resposta sem versão');
    // Versão publicada menor ou igual à instalada → nada a oferecer.
    const novidade = maisNovo(remote.version, versaoLocal);
    updateInfo = {
      version:     remote.version,
      downloadUrl: enderecoDownload(remote, url),
      mandatory:   !!remote.mandatory,
      available:   novidade,
      checked:     new Date().toISOString(),
    };
    if (novidade) {
      logger.info(`Atualização disponível: ${remote.version}${remote.mandatory ? ' (obrigatória)' : ''}`);
    }
  } catch (err) {
    logger.warn('Verificação de atualização falhou: ' + err.message);
    updateInfo = { available: false, checked: new Date().toISOString() };
  }
  return updateInfo;
}

function getUpdateInfo() { return updateInfo; }

module.exports = { verificarAtualizacao, getUpdateInfo, maisNovo, URL_INFO_PADRAO };
