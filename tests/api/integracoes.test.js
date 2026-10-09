require('../helpers/contrato');
const request = require('supertest');
const { criarApp } = require('../../src/app');

const CHAVE = 'chave-de-teste';
let app;

beforeEach(() => {
  app = criarApp({ agora: () => new Date('2026-03-10T20:00:00Z'), apiKey: CHAVE });
});

let sequencia = 0;
const apontamento = (extra = {}) => {
  sequencia += 1;
  return {
    ordem: `OP${String(sequencia).padStart(6, '0')}`,
    vin: `9BWZZZ377VT${String(sequencia).padStart(6, '0')}`,
    modelo: 'SUV-M',
    quantidade: 1,
    custo: 85230.5,
    situacao_veiculo: 'PRODUZIDO',
    data_producao: '2026-03-10',
    hora_producao: '19:25',
    ...extra,
  };
};

const api = {
  criar: (corpo) => request(app).post('/api/integracoes').set('x-api-key', CHAVE).send(corpo),
  listar: (query = '') => request(app).get(`/api/integracoes${query}`).set('x-api-key', CHAVE),
  buscar: (id) => request(app).get(`/api/integracoes/${id}`).set('x-api-key', CHAVE),
  corrigir: (id, corpo) => request(app).patch(`/api/integracoes/${id}`).set('x-api-key', CHAVE).send(corpo),
  processar: () => request(app).post('/api/integracoes/processar').set('x-api-key', CHAVE),
  reprocessar: (id) => request(app).post(`/api/integracoes/${id}/reprocessar`).set('x-api-key', CHAVE),
  painel: () => request(app).get('/api/painel'),
};

describe('Autenticação', () => {
  test.each([
    ['sem chave', undefined],
    ['com chave errada', 'chave-invalida'],
  ])('retorna 401 %s', async (_caso, chave) => {
    const req = request(app).get('/api/integracoes');
    if (chave) req.set('x-api-key', chave);
    const res = await req;
    expect(res.status).toBe(401);
    expect(res).toSatisfyContract('get', '/api/integracoes');
  });

  test('não grava nada quando a chave é inválida', async () => {
    await request(app).post('/api/integracoes').set('x-api-key', 'errada').send(apontamento()).expect(401);
    const res = await api.listar();
    expect(res.body.total).toBe(0);
  });

  test('saúde e painel são públicos', async () => {
    await request(app).get('/api/saude').expect(200);
    await api.painel().expect(200);
  });
});

describe('POST /api/integracoes', () => {
  test('201: grava como PENDENTE e devolve Location', async () => {
    const res = await api.criar(apontamento());
    expect(res.status).toBe(201);
    expect(res).toSatisfyContract('post', '/api/integracoes');
    expect(res.body).toMatchObject({ status: 'PENDENTE', tentativas: 0, motivo_erro: null, processado_em: null });
    expect(res.headers.location).toBe(`/api/integracoes/${res.body.id}`);
  });

  test('[BUG-001] hora enviada como HHMM é normalizada para HH:MM', async () => {
    const res = await api.criar(apontamento({ hora_producao: '0705' }));
    expect(res.body.hora_producao).toBe('07:05');
  });

  test('400: lista todos os erros de validação', async () => {
    const res = await api.criar({});
    expect(res.status).toBe(400);
    expect(res).toSatisfyContract('post', '/api/integracoes');
    expect(res.body.erros).toHaveLength(7);
  });

  test('400: JSON malformado não derruba a API', async () => {
    const res = await request(app)
      .post('/api/integracoes')
      .set('x-api-key', CHAVE)
      .set('Content-Type', 'application/json')
      .send('{"ordem": ');
    expect(res.status).toBe(400);
    expect(res).toSatisfyContract('post', '/api/integracoes');
  });

  test('409: mesma ordem e VIN não entram duas vezes (idempotência)', async () => {
    const corpo = apontamento();
    await api.criar(corpo).expect(201);
    const res = await api.criar(corpo);
    expect(res.status).toBe(409);
    expect(res).toSatisfyContract('post', '/api/integracoes');
  });

  test('texto com SQL é gravado como dado', async () => {
    const res = await api.criar(apontamento({ modelo: "SUV'; DROP TABLE integracoes;--" }));
    expect(res.status).toBe(201);
    await api.listar().expect(200);
  });
});

describe('GET /api/integracoes', () => {
  beforeEach(async () => {
    for (let i = 0; i < 5; i += 1) await api.criar(apontamento());
    await api.criar(apontamento({ modelo: 'SEDAN-C', custo: 0 }));
  });

  test('pagina os resultados do mais novo para o mais antigo', async () => {
    const res = await api.listar('?limite=4&pagina=2');
    expect(res).toSatisfyContract('get', '/api/integracoes');
    expect(res.body).toMatchObject({ pagina: 2, limite: 4, total: 6 });
    expect(res.body.dados).toHaveLength(2);
    expect(res.body.dados[0].id).toBeGreaterThan(res.body.dados[1].id);
  });

  test('página além do fim volta vazia, sem erro', async () => {
    const res = await api.listar('?pagina=99');
    expect(res.status).toBe(200);
    expect(res.body.dados).toEqual([]);
  });

  test('filtra por modelo e por status (sem diferenciar maiúsculas)', async () => {
    await api.processar();
    const porModelo = await api.listar('?modelo=SEDAN-C');
    expect(porModelo.body.total).toBe(1);

    const comErro = await api.listar('?status=erro');
    expect(comErro.body.total).toBe(1);
    expect(comErro.body.dados[0].modelo).toBe('SEDAN-C');
  });

  test.each(['?status=CANCELADO', '?pagina=0', '?limite=101', '?limite=abc'])('400 para filtro inválido %s', async (query) => {
    const res = await api.listar(query);
    expect(res.status).toBe(400);
    expect(res).toSatisfyContract('get', '/api/integracoes');
  });
});

describe('Processamento pelo ERP', () => {
  test('integra os válidos e acumula os motivos dos inválidos', async () => {
    const ok = await api.criar(apontamento());
    const semCusto = await api.criar(apontamento({ custo: 0 }));
    const semNada = await api.criar(apontamento({ custo: 0, situacao_veiculo: '' }));

    const res = await api.processar();
    expect(res).toSatisfyContract('post', '/api/integracoes/processar');
    expect(res.body).toEqual({ processados: 3, integrados: 1, erros: 2 });

    expect((await api.buscar(ok.body.id)).body.status).toBe('INTEGRADO');
    expect((await api.buscar(semCusto.body.id)).body.motivo_erro).toBe('Custo zerado');
    expect((await api.buscar(semNada.body.id)).body.motivo_erro).toBe('Custo zerado; Situação do veículo não informada');
  });

  test('processar de novo não mexe em quem já foi processado', async () => {
    await api.criar(apontamento());
    await api.processar();
    const res = await api.processar();
    expect(res.body).toEqual({ processados: 0, integrados: 0, erros: 0 });
  });
});

describe('Correção e reprocessamento', () => {
  test('fluxo completo: erro → corrigir → reprocessar → integrado', async () => {
    const { body: criado } = await api.criar(apontamento({ custo: 0 }));
    await api.processar();

    const corrigido = await api.corrigir(criado.id, { custo: 79000 });
    expect(corrigido).toSatisfyContract('patch', '/api/integracoes/{id}');
    expect(corrigido.body.custo).toBe(79000);

    const reprocessado = await api.reprocessar(criado.id);
    expect(reprocessado).toSatisfyContract('post', '/api/integracoes/{id}/reprocessar');
    expect(reprocessado.body).toMatchObject({ status: 'PENDENTE', motivo_erro: null });

    await api.processar();
    const final = await api.buscar(criado.id);
    expect(final.body).toMatchObject({ status: 'INTEGRADO', tentativas: 2 });
  });

  test('409 ao corrigir registro já integrado', async () => {
    const { body } = await api.criar(apontamento());
    await api.processar();
    const res = await api.corrigir(body.id, { custo: 1 });
    expect(res.status).toBe(409);
    expect(res).toSatisfyContract('patch', '/api/integracoes/{id}');
  });

  test('400 ao tentar corrigir campo não permitido', async () => {
    const { body } = await api.criar(apontamento());
    const res = await api.corrigir(body.id, { vin: 'LVVDB11B0ME000001' });
    expect(res.status).toBe(400);
    expect(res).toSatisfyContract('patch', '/api/integracoes/{id}');
  });

  test('409 ao reprocessar registro que não está com erro', async () => {
    const { body } = await api.criar(apontamento());
    const res = await api.reprocessar(body.id);
    expect(res.status).toBe(409);
    expect(res).toSatisfyContract('post', '/api/integracoes/{id}/reprocessar');
  });

  test.each([
    ['get', (id) => api.buscar(id), '/api/integracoes/{id}'],
    ['patch', (id) => api.corrigir(id, { custo: 1 }), '/api/integracoes/{id}'],
    ['post', (id) => api.reprocessar(id), '/api/integracoes/{id}/reprocessar'],
  ])('404 em %s de id inexistente', async (metodo, chamar, rota) => {
    const res = await chamar(999);
    expect(res.status).toBe(404);
    expect(res).toSatisfyContract(metodo, rota);
  });
});

describe('GET /api/painel', () => {
  test('painel vazio', async () => {
    const res = await api.painel();
    expect(res).toSatisfyContract('get', '/api/painel');
    expect(res.body).toEqual({ totais: { PENDENTE: 0, INTEGRADO: 0, ERRO: 0 }, erros_por_motivo: [], ultima_integracao: null });
  });

  test('totaliza por status e por motivo de erro', async () => {
    await api.criar(apontamento());
    await api.criar(apontamento({ custo: 0 }));
    await api.criar(apontamento({ custo: 0, situacao_veiculo: '' }));
    await api.processar();
    await api.criar(apontamento());

    const res = await api.painel();
    expect(res).toSatisfyContract('get', '/api/painel');
    expect(res.body.totais).toEqual({ PENDENTE: 1, INTEGRADO: 1, ERRO: 2 });
    expect(res.body.erros_por_motivo).toEqual([
      { motivo: 'Custo zerado', quantidade: 2 },
      { motivo: 'Situação do veículo não informada', quantidade: 1 },
    ]);
  });

  test('[BUG-001] última integração exibe a hora correta, venha ela como HH:MM ou HHMM', async () => {
    await api.criar(apontamento({ hora_producao: '1810' }));
    const ultimo = await api.criar(apontamento({ hora_producao: '19:25' }));
    await api.processar();

    const res = await api.painel();
    expect(res).toSatisfyContract('get', '/api/painel');
    expect(res.body.ultima_integracao).toEqual({ vin: ultimo.body.vin, modelo: 'SUV-M', data: '2026-03-10', hora: '19:25' });
  });
});

describe('Documentação', () => {
  test('publica o openapi.yaml e a interface do Swagger', async () => {
    const spec = await request(app).get('/openapi.yaml').expect(200);
    expect(spec.text).toContain('openapi: 3.1.0');
    await request(app).get('/docs/').expect(200);
  });

  test('rota inexistente devolve 404 em JSON', async () => {
    const res = await request(app).get('/api/nao-existe').expect(404);
    expect(res.body).toEqual({ erro: 'Rota não encontrada' });
  });
});
