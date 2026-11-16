'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const {
  launchNavegador, verificarNavegador, MENSAGEM_SEM_NAVEGADOR,
} = require('../src/services/navegador');

// Dublê do chromium.launch: `disponiveis` diz quais canais "existem" na máquina.
function dubleLancador(disponiveis) {
  const chamadas = [];
  const lancar = async (opcoes) => {
    chamadas.push(opcoes);
    if (!disponiveis.includes(opcoes.channel)) {
      throw new Error(`browserType.launch: Chromium distribution '${opcoes.channel}' is not found\nlinha 2`);
    }
    return { canalAberto: opcoes.channel, close: async () => {} };
  };
  return { lancar, chamadas };
}

test('Edge disponível → usa msedge e nem tenta o Chrome', async () => {
  const d = dubleLancador(['msedge', 'chrome']);
  const r = await launchNavegador({ headless: true }, d);
  assert.equal(r.canal, 'msedge');
  assert.equal(r.browser.canalAberto, 'msedge');
  assert.deepEqual(d.chamadas.map(c => c.channel), ['msedge']);
});

test('Edge falha e Chrome funciona → usa chrome', async () => {
  const d = dubleLancador(['chrome']);
  const r = await launchNavegador({ headless: true }, d);
  assert.equal(r.canal, 'chrome');
  assert.deepEqual(d.chamadas.map(c => c.channel), ['msedge', 'chrome']);
});

test('nenhum dos dois → erro claro em português, com as tentativas', async () => {
  const d = dubleLancador([]);
  await assert.rejects(launchNavegador({}, d), (err) => {
    assert.equal(err.message, MENSAGEM_SEM_NAVEGADOR);
    assert.equal(err.message, 'Nenhum navegador compatível encontrado: instale ou atualize o Microsoft Edge');
    assert.equal(err.code, 'SEM_NAVEGADOR');
    assert.equal(err.tentativas.length, 2);
    assert.match(err.tentativas[0], /^msedge: /);
    assert.match(err.tentativas[1], /^chrome: /);
    assert.doesNotMatch(err.tentativas[0], /linha 2/); // só a primeira linha do erro
    return true;
  });
});

test('repassa as opções e o canal sobrescreve qualquer channel recebido', async () => {
  const d = dubleLancador(['msedge']);
  await launchNavegador({ headless: false, args: ['--start-maximized'], channel: 'chromium' }, d);
  assert.deepEqual(d.chamadas[0], { headless: false, args: ['--start-maximized'], channel: 'msedge' });
});

test('verificarNavegador: ok com canal, ou falha sem lançar exceção', async () => {
  assert.deepEqual(await verificarNavegador(dubleLancador(['chrome'])), { ok: true, canal: 'chrome' });
  const falha = await verificarNavegador(dubleLancador([]));
  assert.equal(falha.ok, false);
  assert.equal(falha.canal, null);
  assert.equal(falha.erro, MENSAGEM_SEM_NAVEGADOR);
});
