'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const path   = require('path');
const { validarPedido } = require('../src/modules/pedidoDiaria/contrato');

const DOC = fs.readFileSync(path.join(__dirname, '..', 'docs', 'contrato-pedido-diaria.md'), 'utf8');
const EXEMPLO = JSON.parse(/```json\n([\s\S]*?)```/.exec(DOC.replace(/\r\n/g, '\n'))[1]);

test('o exemplo do docs/contrato-pedido-diaria.md é aceito e normalizado', () => {
  const r = validarPedido(EXEMPLO);
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  assert.deepEqual(r.valor, {
    tipoViagem: 'ESTADUAL',
    destinoUF: 'PB',
    destinoCidade: 'Campina Grande',
    dataSaida: '2026-11-23T08:00',
    dataRetorno: '2026-11-23T18:00',
    justificativa: null,
    integrantes: [{ nome: 'NOME COMPLETO DO INTEGRANTE', lotacao: null }],
  });
});

test('o formato que a tela "Pedido de teste" monta é o mesmo do contrato', () => {
  // public/index.html → montarPedido(): mesmas chaves, na mesma forma.
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const corpo = /function montarPedido\(\) \{([\s\S]*?)\n\}/.exec(html)[1];
  const chaves = [...corpo.matchAll(/^\s{4}(\w+):/gm)].map(m => m[1]);
  assert.deepEqual(chaves.sort(), Object.keys(EXEMPLO).sort());
  assert.match(corpo, /\{ nome: .*, lotacao: .* \}/);
});

test('justificativa e lotação: texto é aparado; vazio vira null', () => {
  const r = validarPedido({
    ...EXEMPLO,
    tipoViagem: 'Nacional', destinoUF: 'pe',
    justificativa: '  Ensaio geral  ',
    integrantes: [{ nome: ' FULANO ', lotacao: '  ' }, { nome: 'BELTRANO', lotacao: 'Patos' }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.valor.tipoViagem, 'NACIONAL');
  assert.equal(r.valor.destinoUF, 'PE');
  assert.equal(r.valor.justificativa, 'Ensaio geral');
  assert.deepEqual(r.valor.integrantes, [{ nome: 'FULANO', lotacao: null }, { nome: 'BELTRANO', lotacao: 'Patos' }]);
});

test('campos desconhecidos são ignorados (nem credencial passa pelo payload)', () => {
  const r = validarPedido({ ...EXEMPLO, senha: 'x', seadSenha: 'y', requisitante: 'z' });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.valor).sort(), Object.keys(EXEMPLO).sort());
});

test('recusas com mensagem por campo', () => {
  const casos = [
    [null, /objeto/],
    [{ ...EXEMPLO, tipoViagem: 'municipal' }, /tipoViagem/],
    [{ ...EXEMPLO, destinoUF: 'XX' }, /destinoUF/],
    [{ ...EXEMPLO, destinoCidade: '  ' }, /destinoCidade/],
    [{ ...EXEMPLO, dataSaida: '23/11/2026 08:00' }, /dataSaida/],
    [{ ...EXEMPLO, dataSaida: '2026-02-30T08:00' }, /dataSaida/],
    [{ ...EXEMPLO, dataRetorno: '2026-11-23T24:00' }, /dataRetorno/],
    [{ ...EXEMPLO, dataRetorno: '2026-11-22T18:00' }, /anterior/],
    [{ ...EXEMPLO, justificativa: 42 }, /justificativa/],
    [{ ...EXEMPLO, integrantes: [] }, /integrantes/],
    [{ ...EXEMPLO, integrantes: [{ nome: '' }] }, /integrantes\[0\]\.nome/],
    [{ ...EXEMPLO, integrantes: [{ nome: 'A', lotacao: 7 }] }, /integrantes\[0\]\.lotacao/],
    [{ ...EXEMPLO, integrantes: [{ musico: { nome: 'A' } }] }, /integrantes\[0\]\.nome/],
  ];
  for (const [p, re] of casos) {
    const r = validarPedido(p);
    assert.equal(r.ok, false, JSON.stringify(p));
    assert.match(r.erros.join(' | '), re);
  }
});
