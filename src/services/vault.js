'use strict';

/**
 * Armazena credenciais locais criptografadas com AES-256-GCM.
 * A chave é derivada de informações da máquina via PBKDF2,
 * sem depender de módulos nativos externos.
 */

const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const { CONFIG_DIR } = require('../config');

const VAULT_FILE = path.join(CONFIG_DIR, 'vault.dat');
const SALT       = Buffer.from('sisbanda-agent-vault-v1');

function derivarChave() {
  const seed = `${os.hostname()}::${os.userInfo().username}::sisbanda`;
  return crypto.pbkdf2Sync(seed, SALT, 100_000, 32, 'sha256');
}

function encriptar(plaintext) {
  const key  = derivarChave();
  const iv   = crypto.randomBytes(12);
  const ciph = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc  = Buffer.concat([ciph.update(plaintext, 'utf8'), ciph.final()]);
  const tag  = ciph.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decriptar(data) {
  const buf  = Buffer.from(data, 'base64');
  const iv   = buf.subarray(0, 12);
  const tag  = buf.subarray(12, 28);
  const enc  = buf.subarray(28);
  const key  = derivarChave();
  const dec  = crypto.createDecipheriv('aes-256-gcm', key, iv);
  dec.setAuthTag(tag);
  return dec.update(enc) + dec.final('utf8');
}

function salvarCredenciais(dados) {
  fs.writeFileSync(VAULT_FILE, encriptar(JSON.stringify(dados)), 'utf8');
}

function carregarCredenciais() {
  if (!fs.existsSync(VAULT_FILE)) return null;
  try {
    return JSON.parse(decriptar(fs.readFileSync(VAULT_FILE, 'utf8')));
  } catch {
    return null;
  }
}

function limparCredenciais() {
  if (fs.existsSync(VAULT_FILE)) fs.unlinkSync(VAULT_FILE);
}

module.exports = { salvarCredenciais, carregarCredenciais, limparCredenciais };
