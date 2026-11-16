'use strict';

/**
 * Barreira de origem do Agent.
 *
 * O Agent escuta só em 127.0.0.1, mas qualquer página aberta no navegador da
 * máquina consegue mandar requisições para localhost. Esta barreira decide quem
 * pode falar com ele:
 *
 *  - Cabeçalho Origin presente e fora da lista → 403 (HTTP, inclusive preflight)
 *    ou conexão recusada (WebSocket). Origin "null" (file://, iframe sandbox,
 *    data:) conta como origem estranha.
 *  - Sem Origin → aceita: navegação direta, curl e scripts na própria máquina.
 *  - Host fora de localhost/127.0.0.1/[::1] na porta do Agent → 403. Isso fecha
 *    o DNS rebinding: uma página de evil.com que passe a resolver para 127.0.0.1
 *    faz requisições "de mesma origem", sem Origin, mas com Host: evil.com.
 *
 * A lista vem do config.json (allowedOrigins), lida na partida do Agent. A
 * origem da própria UI do Agent (http://localhost:<porta>) entra sempre.
 */

const HOSTS_LOCAIS = ['localhost', '127.0.0.1', '[::1]'];

function normalizarOrigem(o) {
  return String(o || '').trim().replace(/\/+$/, '').toLowerCase();
}

function origensDaUi(porta) {
  return HOSTS_LOCAIS.map(h => `http://${h}:${porta}`);
}

/**
 * @param {object} opcoes
 * @param {string[]} opcoes.origens   origens do config.json (allowedOrigins)
 * @param {() => number} opcoes.porta porta em que o Agent está escutando
 */
function criarBarreira({ origens, porta }) {
  const configuradas = (Array.isArray(origens) ? origens : [])
    .filter(o => typeof o === 'string')
    .map(normalizarOrigem)
    .filter(Boolean);

  function permitidas() {
    return new Set([...configuradas, ...origensDaUi(porta())]);
  }

  function hostPermitido(host) {
    if (!host) return false;
    const h = String(host).toLowerCase();
    return HOSTS_LOCAIS.some(l => h === `${l}:${porta()}`);
  }

  // undefined = sem cabeçalho Origin (aceito). String = precisa estar na lista.
  function origemPermitida(origin) {
    if (origin === undefined) return true;
    return permitidas().has(normalizarOrigem(origin));
  }

  /** Motivo da recusa, ou null se a requisição pode seguir. */
  function avaliar(headers) {
    if (!hostPermitido(headers.host)) return 'Host não permitido.';
    if (!origemPermitida(headers.origin)) return 'Origem não permitida.';
    return null;
  }

  function middlewareHttp(req, res, next) {
    const motivo = avaliar(req.headers);
    if (!motivo) return next();
    res.status(403).json({ error: motivo });
  }

  // Para o `verifyClient` do ws: (info, cb) → cb(aceita, código, mensagem).
  function verificarWs(info, cb) {
    const motivo = avaliar(info.req.headers);
    if (!motivo) return cb(true);
    cb(false, 403, motivo);
  }

  return { middlewareHttp, verificarWs, origemPermitida, hostPermitido, permitidas };
}

module.exports = { criarBarreira, origensDaUi, normalizarOrigem };
