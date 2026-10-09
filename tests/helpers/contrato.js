/**
 * Teste de contrato: valida se cada resposta da API está documentada no openapi.yaml
 * e se o corpo bate exatamente com o schema (campos, tipos, formatos e campos extras).
 *
 * Uso: expect(res).toSatisfyContract('post', '/api/integracoes')
 */
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const spec = yaml.load(fs.readFileSync(path.join(__dirname, '..', '..', 'openapi.yaml'), 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);

const cache = new Map();

function resolver(ref) {
  return ref
    .replace(/^#\//, '')
    .split('/')
    .reduce((obj, chave) => obj[chave.replace(/~1/g, '/').replace(/~0/g, '~')], spec);
}

function schemaDaResposta(metodo, rota, status) {
  const operacao = spec.paths[rota] && spec.paths[rota][metodo];
  if (!operacao) throw new Error(`Operação ${metodo.toUpperCase()} ${rota} não existe no contrato`);

  let resposta = operacao.responses[String(status)];
  if (!resposta) return { naoDocumentado: true };
  if (resposta.$ref) resposta = resolver(resposta.$ref);

  const schema = resposta.content && resposta.content['application/json'] && resposta.content['application/json'].schema;
  return { schema };
}

function validador(metodo, rota, status) {
  const chave = `${metodo} ${rota} ${status}`;
  if (!cache.has(chave)) {
    const { schema, naoDocumentado } = schemaDaResposta(metodo, rota, status);
    // Os $ref internos (#/components/...) são resolvidos contra a raiz deste schema
    cache.set(chave, naoDocumentado ? null : ajv.compile({ ...schema, components: spec.components }));
  }
  return cache.get(chave);
}

expect.extend({
  toSatisfyContract(res, metodo, rota) {
    const status = res.status;
    const validar = validador(metodo.toLowerCase(), rota, status);
    const op = `${metodo.toUpperCase()} ${rota}`;

    if (validar === null) {
      return { pass: false, message: () => `Status ${status} não está documentado para ${op} no openapi.yaml` };
    }
    const ok = validar(res.body);
    return {
      pass: ok,
      message: () =>
        ok
          ? `Esperava que a resposta ${status} de ${op} NÃO satisfizesse o contrato`
          : `Resposta ${status} de ${op} fora do contrato:\n${ajv.errorsText(validar.errors, { separator: '\n' })}\n\nCorpo: ${JSON.stringify(res.body, null, 2)}`,
    };
  },
});

module.exports = { spec };
