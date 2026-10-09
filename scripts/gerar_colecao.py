"""Gera a coleção Postman a partir de uma definição legível.
Mantido no repositório para a coleção poder ser revisada e regenerada."""
import json, pathlib

def req(nome, metodo, rota, testes, corpo=None, pre=None, chave=True):
    headers = [{"key": "Content-Type", "value": "application/json"}] if corpo is not None else []
    if chave:
        headers.append({"key": "x-api-key", "value": "{{apiKey}}"})
    caminho = [p for p in rota.split("?")[0].strip("/").split("/")]
    url = {"raw": "{{baseUrl}}" + rota, "host": ["{{baseUrl}}"], "path": caminho}
    if "?" in rota:
        url["query"] = [{"key": k, "value": v} for k, v in (q.split("=") for q in rota.split("?")[1].split("&"))]
    item = {"name": nome, "request": {"method": metodo, "header": headers, "url": url}, "event": []}
    if corpo is not None:
        item["request"]["body"] = {"mode": "raw", "raw": json.dumps(corpo, indent=2, ensure_ascii=False),
                                   "options": {"raw": {"language": "json"}}}
    if pre:
        item["event"].append({"listen": "prerequest", "script": {"type": "text/javascript", "exec": pre.strip().split("\n")}})
    item["event"].append({"listen": "test", "script": {"type": "text/javascript", "exec": testes.strip().split("\n")}})
    return item

def pasta(nome, descricao, itens):
    return {"name": nome, "description": descricao, "item": itens}

NOVO_ID = """
// Gera ordem e VIN únicos a cada execução (VIN sem I, O e Q)
const seq = String(Date.now()).slice(-6);
pm.collectionVariables.set('ordem', 'OP' + seq);
pm.collectionVariables.set('vin', '9BWZZZ377VT' + seq);
"""

def apontamento(**extra):
    base = {"ordem": "{{ordem}}", "vin": "{{vin}}", "modelo": "SUV-M", "quantidade": 1, "custo": 85230.5,
            "situacao_veiculo": "PRODUZIDO", "data_producao": "2026-03-10", "hora_producao": "19:25"}
    base.update(extra)
    return base

colecao = {
  "info": {
    "name": "Monitor de Integração MES → ERP",
    "description": "Testes de API executados no CI com Newman. Rodar as pastas na ordem: cada fluxo encadeia ids via variáveis da coleção.",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "event": [{"listen": "test", "script": {"type": "text/javascript", "exec": [
      "// Validações aplicadas a TODAS as requisições",
      "pm.test('[geral] responde em menos de 1s', () => pm.expect(pm.response.responseTime).to.be.below(1000));",
      "pm.test('[geral] resposta em JSON', () => pm.expect(pm.response.headers.get('Content-Type')).to.include('application/json'));"
  ]}}],
  "variable": [{"key": "ordem", "value": ""}, {"key": "vin", "value": ""}, {"key": "id", "value": ""}, {"key": "idErro", "value": ""}],
  "item": [
    pasta("01 - Saúde e autenticação", "Disponibilidade da API e proteção por chave.", [
      req("Saúde da API", "GET", "/api/saude", """
pm.test('status 200', () => pm.response.to.have.status(200));
pm.test('status ok', () => pm.expect(pm.response.json().status).to.eql('ok'));
""", chave=False),
      req("Listar sem chave de API → 401", "GET", "/api/integracoes", """
pm.test('status 401', () => pm.response.to.have.status(401));
pm.test('mensagem de erro', () => pm.expect(pm.response.json().erro).to.match(/Chave de API/));
""", chave=False),
    ]),
    pasta("02 - Fluxo feliz", "Apontamento válido do MES até a integração no ERP.", [
      req("Criar apontamento", "POST", "/api/integracoes", """
pm.test('status 201', () => pm.response.to.have.status(201));
const corpo = pm.response.json();
pm.test('entra na fila como PENDENTE', () => {
  pm.expect(corpo.status).to.eql('PENDENTE');
  pm.expect(corpo.tentativas).to.eql(0);
  pm.expect(corpo.motivo_erro).to.be.null;
});
pm.test('header Location aponta para o registro', () =>
  pm.expect(pm.response.headers.get('Location')).to.eql('/api/integracoes/' + corpo.id));
pm.test('schema da integração', () => pm.response.to.have.jsonSchema({
  type: 'object',
  required: ['id', 'ordem', 'vin', 'status', 'hora_producao'],
  properties: {
    id: { type: 'integer' },
    vin: { type: 'string', pattern: '^[A-HJ-NPR-Z0-9]{17}$' },
    hora_producao: { type: 'string', pattern: '^\\\\d{2}:\\\\d{2}$' },
    status: { enum: ['PENDENTE', 'INTEGRADO', 'ERRO'] }
  }
}));
pm.collectionVariables.set('id', corpo.id);
""", corpo=apontamento(), pre=NOVO_ID),
      req("Enviar o mesmo apontamento de novo → 409", "POST", "/api/integracoes", """
pm.test('status 409 (idempotência por ordem + VIN)', () => pm.response.to.have.status(409));
""", corpo=apontamento()),
      req("Processar fila (ERP)", "POST", "/api/integracoes/processar", """
pm.test('status 200', () => pm.response.to.have.status(200));
const r = pm.response.json();
pm.test('processou ao menos o registro criado', () => pm.expect(r.integrados).to.be.at.least(1));
pm.test('totais consistentes', () => pm.expect(r.integrados + r.erros).to.eql(r.processados));
"""),
      req("Consultar registro integrado", "GET", "/api/integracoes/{{id}}", """
pm.test('status 200', () => pm.response.to.have.status(200));
const r = pm.response.json();
pm.test('ficou INTEGRADO', () => pm.expect(r.status).to.eql('INTEGRADO'));
pm.test('registrou data de processamento', () => pm.expect(r.processado_em).to.match(/^\\d{4}-\\d{2}-\\d{2}T/));
"""),
    ]),
    pasta("03 - Erro, correção e reprocessamento", "Registro com custo zerado cai em erro, é corrigido e reprocessado.", [
      req("Criar apontamento com custo zerado", "POST", "/api/integracoes", """
pm.test('status 201', () => pm.response.to.have.status(201));
pm.collectionVariables.set('idErro', pm.response.json().id);
""", corpo=apontamento(custo=0), pre=NOVO_ID),
      req("Processar fila (ERP)", "POST", "/api/integracoes/processar", """
pm.test('status 200', () => pm.response.to.have.status(200));
pm.test('gerou erro', () => pm.expect(pm.response.json().erros).to.be.at.least(1));
"""),
      req("Consultar registro com erro", "GET", "/api/integracoes/{{idErro}}", """
const r = pm.response.json();
pm.test('ficou com ERRO', () => pm.expect(r.status).to.eql('ERRO'));
pm.test('motivo: custo zerado', () => pm.expect(r.motivo_erro).to.eql('Custo zerado'));
"""),
      req("Reprocessar registro já integrado → 409", "POST", "/api/integracoes/{{id}}/reprocessar", """
pm.test('status 409: registro integrado não pode ser reprocessado', () => pm.response.to.have.status(409));
"""),
      req("Corrigir custo", "PATCH", "/api/integracoes/{{idErro}}", """
pm.test('status 200', () => pm.response.to.have.status(200));
pm.test('custo atualizado', () => pm.expect(pm.response.json().custo).to.eql(79000));
""", corpo={"custo": 79000}),
      req("Reprocessar", "POST", "/api/integracoes/{{idErro}}/reprocessar", """
pm.test('status 200', () => pm.response.to.have.status(200));
const r = pm.response.json();
pm.test('voltou para PENDENTE e limpou o motivo', () => {
  pm.expect(r.status).to.eql('PENDENTE');
  pm.expect(r.motivo_erro).to.be.null;
});
"""),
      req("Processar fila (ERP)", "POST", "/api/integracoes/processar", """
pm.test('status 200', () => pm.response.to.have.status(200));
"""),
      req("Consultar registro corrigido", "GET", "/api/integracoes/{{idErro}}", """
const r = pm.response.json();
pm.test('agora está INTEGRADO', () => pm.expect(r.status).to.eql('INTEGRADO'));
pm.test('contou duas tentativas', () => pm.expect(r.tentativas).to.eql(2));
"""),
      req("Corrigir registro já integrado → 409", "PATCH", "/api/integracoes/{{idErro}}", """
pm.test('status 409', () => pm.response.to.have.status(409));
""", corpo={"custo": 1}),
    ]),
    pasta("04 - Validações", "Entradas inválidas e casos de borda.", [
      req("Corpo vazio → 400 com todos os erros", "POST", "/api/integracoes", """
pm.test('status 400', () => pm.response.to.have.status(400));
pm.test('lista os 7 campos com problema', () => pm.expect(pm.response.json().erros).to.have.lengthOf(7));
""", corpo={}),
      req("VIN com letra O → 400", "POST", "/api/integracoes", """
pm.test('status 400', () => pm.response.to.have.status(400));
pm.test('aponta o VIN', () => pm.expect(pm.response.json().erros[0]).to.match(/vin/));
""", corpo=apontamento(vin="9BWZZZ377VT00425O"), pre=NOVO_ID),
      req("[BUG-001] Hora no formato HHMM é normalizada", "POST", "/api/integracoes", """
pm.test('status 201', () => pm.response.to.have.status(201));
pm.test('0705 vira 07:05', () => pm.expect(pm.response.json().hora_producao).to.eql('07:05'));
""", corpo=apontamento(hora_producao="0705"), pre=NOVO_ID),
      req("Hora inválida 24:00 → 400", "POST", "/api/integracoes", """
pm.test('status 400', () => pm.response.to.have.status(400));
""", corpo=apontamento(hora_producao="24:00"), pre=NOVO_ID),
      req("Filtro de status inválido → 400", "GET", "/api/integracoes?status=CANCELADO", """
pm.test('status 400', () => pm.response.to.have.status(400));
"""),
      req("Limite acima de 100 → 400", "GET", "/api/integracoes?limite=101", """
pm.test('status 400', () => pm.response.to.have.status(400));
"""),
      req("Registro inexistente → 404", "GET", "/api/integracoes/999999", """
pm.test('status 404', () => pm.response.to.have.status(404));
"""),
    ]),
    pasta("05 - Painel", "Indicadores consumidos pela tela de acompanhamento.", [
      req("Painel", "GET", "/api/painel", """
pm.test('status 200', () => pm.response.to.have.status(200));
const p = pm.response.json();
pm.test('totais por status', () => pm.expect(p.totais).to.have.all.keys('PENDENTE', 'INTEGRADO', 'ERRO'));
pm.test('última integração com hora HH:MM (BUG-001)', () =>
  pm.expect(p.ultima_integracao.hora).to.match(/^([01]\\d|2[0-3]):[0-5]\\d$/));
""", chave=False),
    ]),
  ]
}

base = pathlib.Path(__file__).resolve().parent.parent / "postman"
(base / "monitor-integracao.postman_collection.json").write_text(json.dumps(colecao, indent=2, ensure_ascii=False) + "\n")
(base / "local.postman_environment.json").write_text(json.dumps({
  "name": "Local",
  "values": [
    {"key": "baseUrl", "value": "http://localhost:3000", "type": "default", "enabled": True},
    {"key": "apiKey", "value": "chave-dev", "type": "secret", "enabled": True}
  ]
}, indent=2, ensure_ascii=False) + "\n")
print("ok")
