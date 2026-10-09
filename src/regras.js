/**
 * Regras de negócio puras da integração MES → ERP.
 * Sem banco e sem HTTP, para serem testadas de forma unitária.
 */

const STATUS = Object.freeze({
  PENDENTE: 'PENDENTE',
  INTEGRADO: 'INTEGRADO',
  ERRO: 'ERRO',
});

const MOTIVOS = Object.freeze({
  CUSTO_ZERO: 'Custo zerado',
  SITUACAO_VAZIA: 'Situação do veículo não informada',
});

// VIN: 17 caracteres, sem I, O e Q (ISO 3779)
const REGEX_VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const REGEX_ORDEM = /^OP\d{6}$/;
const REGEX_DATA = /^\d{4}-\d{2}-\d{2}$/;
const REGEX_HORA = /^(\d{2}):?(\d{2})$/;

function validarVin(vin) {
  return typeof vin === 'string' && REGEX_VIN.test(vin);
}

function dataValida(texto) {
  if (typeof texto !== 'string' || !REGEX_DATA.test(texto)) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

/**
 * Normaliza a hora de produção para HH:MM.
 * O MES pode enviar "1925" ou "19:25"; as duas formas são aceitas.
 * Retorna null quando a hora é inválida.
 */
function formatarHora(valor) {
  const m = REGEX_HORA.exec(String(valor ?? '').trim());
  if (!m) return null;
  const [hh, mm] = [Number(m[1]), Number(m[2])];
  if (hh > 23 || mm > 59) return null;
  return `${m[1]}:${m[2]}`;
}

/** Valida o apontamento enviado pelo MES. Retorna a lista de erros (vazia = válido). */
function validarApontamento(dados, hoje) {
  const d = dados || {};
  const erros = [];

  if (!REGEX_ORDEM.test(String(d.ordem ?? ''))) erros.push('ordem deve seguir o formato OP000000');
  if (!validarVin(d.vin)) erros.push('vin deve ter 17 caracteres alfanuméricos, sem I, O ou Q');
  if (typeof d.modelo !== 'string' || d.modelo.trim() === '') erros.push('modelo é obrigatório');
  if (!Number.isInteger(d.quantidade) || d.quantidade < 1) erros.push('quantidade deve ser um inteiro maior que zero');
  if (typeof d.custo !== 'number' || !Number.isFinite(d.custo) || d.custo < 0) erros.push('custo deve ser um número maior ou igual a zero');
  if (d.situacao_veiculo !== undefined && typeof d.situacao_veiculo !== 'string') erros.push('situacao_veiculo deve ser texto');

  if (!dataValida(d.data_producao)) {
    erros.push('data_producao deve ser uma data válida no formato AAAA-MM-DD');
  } else if (hoje && d.data_producao > hoje.toISOString().slice(0, 10)) {
    erros.push('data_producao não pode ser futura');
  }

  if (formatarHora(d.hora_producao) === null) erros.push('hora_producao deve estar no formato HH:MM ou HHMM');

  return erros;
}

/**
 * Regra do ERP ao processar um apontamento pendente.
 * Todos os motivos de erro são acumulados, para o usuário corrigir tudo de uma vez.
 */
function avaliarProcessamento(registro) {
  const motivos = [];
  if (!(registro.custo > 0)) motivos.push(MOTIVOS.CUSTO_ZERO);
  if (!registro.situacao_veiculo || String(registro.situacao_veiculo).trim() === '') motivos.push(MOTIVOS.SITUACAO_VAZIA);
  return motivos.length ? { status: STATUS.ERRO, motivos } : { status: STATUS.INTEGRADO, motivos: [] };
}

/** Campos que podem ser corrigidos e em quais status. */
const CAMPOS_CORRIGIVEIS = ['custo', 'situacao_veiculo'];

function validarCorrecao(registro, alteracoes) {
  if (!registro) return { http: 404, erro: 'Integração não encontrada' };
  if (registro.status === STATUS.INTEGRADO) return { http: 409, erro: 'Registro já integrado não pode ser alterado' };

  const chaves = Object.keys(alteracoes || {});
  if (chaves.length === 0) return { http: 400, erro: 'Informe ao menos um campo para corrigir' };
  const invalidas = chaves.filter((c) => !CAMPOS_CORRIGIVEIS.includes(c));
  if (invalidas.length) return { http: 400, erro: `Campos não permitidos: ${invalidas.join(', ')}` };

  if ('custo' in alteracoes && (typeof alteracoes.custo !== 'number' || !(alteracoes.custo >= 0))) {
    return { http: 400, erro: 'custo deve ser um número maior ou igual a zero' };
  }
  if ('situacao_veiculo' in alteracoes && typeof alteracoes.situacao_veiculo !== 'string') {
    return { http: 400, erro: 'situacao_veiculo deve ser texto' };
  }
  return null;
}

module.exports = {
  STATUS,
  MOTIVOS,
  CAMPOS_CORRIGIVEIS,
  validarVin,
  dataValida,
  formatarHora,
  validarApontamento,
  avaliarProcessamento,
  validarCorrecao,
};
