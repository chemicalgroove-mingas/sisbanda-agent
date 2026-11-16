'use strict';

/**
 * Registro, só em memória, dos segredos que o processo já tocou (a senha do
 * SEAD). Tudo o que sai do Agent como texto — log, passo de job, erro de job,
 * mensagem de WebSocket — passa por redigir() antes.
 *
 * O cofre registra a senha no momento em que a lê ou grava; ninguém mais
 * precisa lembrar de fazer isso.
 */

const MARCA = '[REDIGIDO]';

// Abaixo disso, redigir mutilaria texto comum (datas, números) sem proteger nada.
const TAMANHO_MINIMO = 4;

const segredos = new Set();

function registrarSegredo(valor) {
  const s = typeof valor === 'string' ? valor : '';
  if (s.length < TAMANHO_MINIMO) return;
  segredos.add(s);
  // A mesma senha também aparece escapada dentro de JSON e em URLs.
  const json = JSON.stringify(s).slice(1, -1);
  if (json !== s) segredos.add(json);
  const url = encodeURIComponent(s);
  if (url !== s) segredos.add(url);
}

function redigir(texto) {
  if (texto === null || texto === undefined) return texto;
  let t = String(texto);
  // Os mais longos primeiro: um segredo que contenha outro é coberto inteiro.
  for (const s of [...segredos].sort((a, b) => b.length - a.length)) {
    if (t.includes(s)) t = t.split(s).join(MARCA);
  }
  return t;
}

// Só para testes.
function _limparRegistro() { segredos.clear(); }

module.exports = { registrarSegredo, redigir, MARCA, TAMANHO_MINIMO, _limparRegistro };
