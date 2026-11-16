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
    requisitante: 'NOME DO REQUISITANTE COMO NO SEAD',
    objetivo: 'PARTICIPAR DE EVENTO',
    justificativa: 'Texto que vai para a aba JUSTIFICATIVA.',
    tipoViagem: 'ESTADUAL',
    destinoUF: 'PB',
    destinoCidade: 'Campina Grande',
    dataSaida: '2026-11-23T08:00',
    dataRetorno: '2026-11-23T18:00',
    integrantes: [{ nome: 'NOME COMPLETO DO INTEGRANTE', cidadeOrigem: 'João Pessoa' }],
  });
});

test('o formato que a tela "Pedido de teste" monta é o mesmo do contrato', () => {
  // public/index.html → montarPedido(): mesmas chaves, na mesma forma.
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const corpo = /function montarPedido\(\) \{([\s\S]*?)\n\}/.exec(html)[1];
  const chaves = [...corpo.matchAll(/^\s{4}(\w+):/gm)].map(m => m[1]);
  assert.deepEqual(chaves.sort(), Object.keys(EXEMPLO).sort());
  assert.match(corpo, /\{ nome: .*, cidadeOrigem: .* \}/);
});

test('texto é aparado; tipo e UF normalizados', () => {
  const r = validarPedido({
    ...EXEMPLO,
    requisitante: '  FULANA  ', objetivo: ' PARTICIPAR DE EVENTO ', justificativa: '  Ensaio geral  ',
    tipoViagem: 'Nacional', destinoUF: 'pe',
    integrantes: [{ nome: ' FULANO ', cidadeOrigem: ' Patos ' }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.valor.requisitante, 'FULANA');
  assert.equal(r.valor.objetivo, 'PARTICIPAR DE EVENTO');
  assert.equal(r.valor.justificativa, 'Ensaio geral');
  assert.equal(r.valor.tipoViagem, 'NACIONAL');
  assert.equal(r.valor.destinoUF, 'PE');
  assert.deepEqual(r.valor.integrantes, [{ nome: 'FULANO', cidadeOrigem: 'Patos' }]);
});

test('campos desconhecidos são ignorados (nem credencial passa pelo payload)', () => {
  const r = validarPedido({ ...EXEMPLO, senha: 'x', seadSenha: 'y', usuario: 'z' });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.valor).sort(), Object.keys(EXEMPLO).sort());
});

test('requisitante, objetivo, justificativa e cidade de origem são obrigatórios (sem padrão no Agent)', () => {
  for (const campo of ['requisitante', 'objetivo', 'justificativa']) {
    for (const ruim of [undefined, null, '', '   ', 42]) {
      const p = { ...EXEMPLO, [campo]: ruim };
      if (ruim === undefined) delete p[campo];
      const r = validarPedido(p);
      assert.equal(r.ok, false, `${campo}=${JSON.stringify(ruim)}`);
      assert.match(r.erros.join(' | '), new RegExp(`${campo} é obrigatóri`));
    }
  }
  for (const ruim of [undefined, null, '', '  ', 7]) {
    const r = validarPedido({ ...EXEMPLO, integrantes: [{ nome: 'A', cidadeOrigem: ruim }] });
    assert.equal(r.ok, false, `cidadeOrigem=${JSON.stringify(ruim)}`);
    assert.match(r.erros.join(' | '), /integrantes\[0\]\.cidadeOrigem é obrigatória/);
  }
  // O nome antigo do campo (protocolo 2) não substitui o novo.
  const antigo = validarPedido({ ...EXEMPLO, integrantes: [{ nome: 'A', lotacao: 'Patos' }] });
  assert.equal(antigo.ok, false);
});

test('recusas com mensagem por campo', () => {
  const casos = [
    [null, /objeto/],
    [{ ...EXEMPLO, tipoViagem: 'municipal' }, /tipoViagem/],
    [{ ...EXEMPLO, destinoUF: 'XX' }, /destinoUF/],
    [{ ...EXEMPLO, destinoCidade: '  ' }, /destinoCidade/],
    [{ ...EXEMPLO, dataSaida: '23/11/2026 08:00' }, /dataSaida/],
    [{ ...EXEMPLO, dataSaida: '2026-02-30T08:00' }, /dataSaida/],
    [{ ...EXEMPLO, dataSaida: '2026-11-23' }, /dataSaida/],
    [{ ...EXEMPLO, dataRetorno: '2026-11-23T24:00' }, /dataRetorno/],
    [{ ...EXEMPLO, dataRetorno: '2026-11-22T18:00' }, /anterior/],
    [{ ...EXEMPLO, integrantes: [] }, /integrantes/],
    [{ ...EXEMPLO, integrantes: [{ nome: '', cidadeOrigem: 'Patos' }] }, /integrantes\[0\]\.nome/],
    [{ ...EXEMPLO, integrantes: [{ musico: { nome: 'A' }, cidadeOrigem: 'Patos' }] }, /integrantes\[0\]\.nome/],
  ];
  for (const [p, re] of casos) {
    const r = validarPedido(p);
    assert.equal(r.ok, false, JSON.stringify(p));
    assert.match(r.erros.join(' | '), re);
  }
});
