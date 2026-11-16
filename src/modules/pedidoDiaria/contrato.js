'use strict';

/**
 * Contrato do payload do módulo 'pedido-diaria'. Documentado em
 * docs/contrato-pedido-diaria.md — mudar aqui é mudar lá.
 *
 * O mesmo validador atende o site (POST /api/run) e o "Pedido de teste" da
 * janela do Agent: os dois caminhos chegam à automação com o mesmo formato.
 *
 * Credencial, requisitante, objetivo e textos padrão NÃO fazem parte do
 * payload: vêm da configuração deste Agent. Campos desconhecidos são ignorados.
 */

const TIPOS = ['ESTADUAL', 'NACIONAL', 'INTERNACIONAL'];
const UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA',
  'PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
];
const RE_DATA_HORA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function textoOuNulo(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return undefined; // tipo errado
  const t = v.trim();
  return t || null;
}

function dataHoraValida(s) {
  const m = RE_DATA_HORA.exec(typeof s === 'string' ? s : '');
  if (!m) return false;
  const [, a, me, d, h, mi] = m.map(Number);
  if (h > 23 || mi > 59) return false;
  const dt = new Date(Date.UTC(a, me - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === me - 1 && dt.getUTCDate() === d;
}

/**
 * @returns {{ ok: true, valor: object } | { ok: false, erros: string[] }}
 */
function validarPedido(p) {
  const erros = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    return { ok: false, erros: ['payload deve ser um objeto.'] };
  }

  const tipo = typeof p.tipoViagem === 'string' ? p.tipoViagem.trim().toUpperCase() : '';
  if (!TIPOS.includes(tipo)) erros.push('tipoViagem deve ser estadual, nacional ou internacional.');

  const uf = typeof p.destinoUF === 'string' ? p.destinoUF.trim().toUpperCase() : '';
  if (!UFS.includes(uf)) erros.push('destinoUF deve ser a sigla de uma UF (ex.: PB).');

  const cidade = textoOuNulo(p.destinoCidade);
  if (!cidade) erros.push('destinoCidade é obrigatório.');

  const saidaOk   = dataHoraValida(p.dataSaida);
  const retornoOk = dataHoraValida(p.dataRetorno);
  if (!saidaOk)   erros.push('dataSaida deve estar no formato AAAA-MM-DDTHH:mm.');
  if (!retornoOk) erros.push('dataRetorno deve estar no formato AAAA-MM-DDTHH:mm.');
  if (saidaOk && retornoOk && p.dataRetorno < p.dataSaida) {
    erros.push('dataRetorno não pode ser anterior a dataSaida.');
  }

  const justificativa = textoOuNulo(p.justificativa);
  if (justificativa === undefined) erros.push('justificativa deve ser texto ou null.');

  const integrantes = [];
  if (!Array.isArray(p.integrantes) || p.integrantes.length === 0) {
    erros.push('integrantes deve ser uma lista com ao menos um integrante.');
  } else {
    p.integrantes.forEach((it, i) => {
      const nome    = it && typeof it === 'object' ? textoOuNulo(it.nome) : undefined;
      const lotacao = it && typeof it === 'object' ? textoOuNulo(it.lotacao) : undefined;
      if (!nome) erros.push(`integrantes[${i}].nome é obrigatório.`);
      if (lotacao === undefined) erros.push(`integrantes[${i}].lotacao deve ser texto ou null.`);
      if (nome && lotacao !== undefined) integrantes.push({ nome, lotacao });
    });
  }

  if (erros.length) return { ok: false, erros };
  return {
    ok: true,
    valor: {
      tipoViagem:    tipo,
      destinoUF:     uf,
      destinoCidade: cidade,
      dataSaida:     p.dataSaida,
      dataRetorno:   p.dataRetorno,
      justificativa,
      integrantes,
    },
  };
}

module.exports = { validarPedido, TIPOS, UFS };
