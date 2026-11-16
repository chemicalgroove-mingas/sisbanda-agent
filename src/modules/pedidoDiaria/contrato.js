'use strict';

/**
 * Contrato do payload do módulo 'pedido-diaria' (protocolo 3). Documentado em
 * docs/contrato-pedido-diaria.md — mudar aqui é mudar lá.
 *
 * O mesmo validador atende o site (POST /api/run) e o "Pedido de teste" da
 * janela do Agent: os dois caminhos chegam à automação com o mesmo formato.
 *
 * TODO parâmetro do pedido vem do site: requisitante, objetivo, justificativa,
 * cidade de origem de cada integrante. O Agent guarda só usuário e senha do
 * SEAD (cofre) e não tem valor padrão para nada: campo faltando é recusado aqui,
 * antes de qualquer navegador abrir. Campos desconhecidos são ignorados.
 */

const TIPOS = ['ESTADUAL', 'NACIONAL', 'INTERNACIONAL'];
const UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA',
  'PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
];
const RE_DATA_HORA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

// Texto obrigatório: string com algo além de espaço. Devolve o texto aparado,
// ou null quando falta / tem tipo errado.
function textoObrigatorio(v) {
  if (typeof v !== 'string') return null;
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

  const requisitante = textoObrigatorio(p.requisitante);
  if (!requisitante) erros.push('requisitante é obrigatório.');

  const objetivo = textoObrigatorio(p.objetivo);
  if (!objetivo) erros.push('objetivo é obrigatório.');

  const justificativa = textoObrigatorio(p.justificativa);
  if (!justificativa) erros.push('justificativa é obrigatória.');

  const tipo = typeof p.tipoViagem === 'string' ? p.tipoViagem.trim().toUpperCase() : '';
  if (!TIPOS.includes(tipo)) erros.push('tipoViagem deve ser estadual, nacional ou internacional.');

  const uf = typeof p.destinoUF === 'string' ? p.destinoUF.trim().toUpperCase() : '';
  if (!UFS.includes(uf)) erros.push('destinoUF deve ser a sigla de uma UF (ex.: PB).');

  const cidade = textoObrigatorio(p.destinoCidade);
  if (!cidade) erros.push('destinoCidade é obrigatório.');

  const saidaOk   = dataHoraValida(p.dataSaida);
  const retornoOk = dataHoraValida(p.dataRetorno);
  if (!saidaOk)   erros.push('dataSaida deve estar no formato AAAA-MM-DDTHH:mm.');
  if (!retornoOk) erros.push('dataRetorno deve estar no formato AAAA-MM-DDTHH:mm.');
  if (saidaOk && retornoOk && p.dataRetorno < p.dataSaida) {
    erros.push('dataRetorno não pode ser anterior a dataSaida.');
  }

  const integrantes = [];
  if (!Array.isArray(p.integrantes) || p.integrantes.length === 0) {
    erros.push('integrantes deve ser uma lista com ao menos um integrante.');
  } else {
    p.integrantes.forEach((it, i) => {
      const obj          = it && typeof it === 'object' ? it : {};
      const nome         = textoObrigatorio(obj.nome);
      const cidadeOrigem = textoObrigatorio(obj.cidadeOrigem);
      if (!nome)         erros.push(`integrantes[${i}].nome é obrigatório.`);
      if (!cidadeOrigem) erros.push(`integrantes[${i}].cidadeOrigem é obrigatória.`);
      if (nome && cidadeOrigem) integrantes.push({ nome, cidadeOrigem });
    });
  }

  if (erros.length) return { ok: false, erros };
  return {
    ok: true,
    valor: {
      requisitante,
      objetivo,
      justificativa,
      tipoViagem:    tipo,
      destinoUF:     uf,
      destinoCidade: cidade,
      dataSaida:     p.dataSaida,
      dataRetorno:   p.dataRetorno,
      integrantes,
    },
  };
}

module.exports = { validarPedido, TIPOS, UFS };
