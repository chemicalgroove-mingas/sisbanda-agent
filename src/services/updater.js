'use strict';

const https  = require('https');
const logger = require('./logger');
const { loadConfig } = require('../config');
const { VERSION }    = require('../versao');

let updateInfo = null; // { version, downloadUrl, mandatory, checked }

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

async function verificarAtualizacao() {
  const cfg = loadConfig();
  const url = cfg.updateUrl || 'https://sisbanda.pcpb.pb.gov.br/agent/latest.json';
  try {
    const remote = await fetchJson(url);
    const novidade = maisNovo(remote.version, VERSION);
    updateInfo = {
      version:     remote.version,
      downloadUrl: remote.downloadUrl || '',
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

module.exports = { verificarAtualizacao, getUpdateInfo };
