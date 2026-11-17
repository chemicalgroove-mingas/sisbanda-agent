'use strict';

// O repositório do Agent é público: nada de dado pessoal pré-preenchido na
// tela, e o package-lock.json acompanha a versão do package.json.

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');

const RAIZ = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(RAIZ, 'public', 'index.html'), 'utf8');

// Campos de pessoa da aba "Pedido de teste".
const CAMPOS_DE_PESSOA = ['tIntegrante', 'tRequisitante'];

for (const id of CAMPOS_DE_PESSOA) {
  test(`aba "Pedido de teste": #${id} existe e vem vazio (sem value)`, () => {
    const tag = html.match(new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`));
    assert.ok(tag, `input #${id} não encontrado`);
    assert.doesNotMatch(tag[0], /\bvalue\s*=/, tag[0]);
  });
}

test('package-lock.json tem a mesma versão do package.json', () => {
  const pkg  = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
});
