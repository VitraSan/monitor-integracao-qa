const {
  validarVin,
  dataValida,
  formatarHora,
  validarApontamento,
  avaliarProcessamento,
  validarCorrecao,
  MOTIVOS,
} = require('../../src/regras');

const HOJE = new Date('2026-03-10T12:00:00Z');

const apontamentoValido = () => ({
  ordem: 'OP000123',
  vin: '9BWZZZ377VT004251',
  modelo: 'SUV-M',
  quantidade: 1,
  custo: 85230.5,
  situacao_veiculo: 'PRODUZIDO',
  data_producao: '2026-03-10',
  hora_producao: '19:25',
});

describe('validarVin', () => {
  test.each(['9BWZZZ377VT004251', 'LVVDB11B0ME000001'])('aceita %s', (vin) => {
    expect(validarVin(vin)).toBe(true);
  });

  test.each([
    ['16 caracteres', '9BWZZZ377VT00425'],
    ['18 caracteres', '9BWZZZ377VT0042511'],
    ['letra I', '9BWZZZ377VT00425I'],
    ['letra O', '9BWZZZ377VT00425O'],
    ['letra Q', '9BWZZZ377VT00425Q'],
    ['minúsculas', '9bwzzz377vt004251'],
    ['espaço no fim', '9BWZZZ377VT00425 '],
    ['número', 12345678901234567],
  ])('rejeita VIN com %s', (_caso, vin) => {
    expect(validarVin(vin)).toBe(false);
  });
});

describe('dataValida', () => {
  test.each([
    ['2026-02-28', true],
    ['2024-02-29', true], // ano bissexto
    ['2026-02-29', false], // não bissexto
    ['2026-13-01', false],
    ['2026-3-10', false],
    ['10/03/2026', false],
  ])('%s => %s', (data, esperado) => {
    expect(dataValida(data)).toBe(esperado);
  });
});

describe('formatarHora', () => {
  // Regressão BUG-001: hora que já vinha com ":" era exibida como "19::2"
  test('[BUG-001] mantém a hora que já chega como HH:MM', () => {
    expect(formatarHora('19:25')).toBe('19:25');
  });

  test('[BUG-001] insere os dois-pontos quando chega como HHMM', () => {
    expect(formatarHora('1925')).toBe('19:25');
  });

  test.each([
    ['00:00', '00:00'],
    ['23:59', '23:59'],
    [' 0705 ', '07:05'],
  ])('valor limite %p => %p', (entrada, esperado) => {
    expect(formatarHora(entrada)).toBe(esperado);
  });

  test.each(['24:00', '23:60', '7:05', '19::25', '19-25', '', null, undefined])('rejeita %p', (entrada) => {
    expect(formatarHora(entrada)).toBeNull();
  });
});

describe('validarApontamento', () => {
  test('aceita apontamento válido', () => {
    expect(validarApontamento(apontamentoValido(), HOJE)).toEqual([]);
  });

  test('situacao_veiculo é opcional na entrada (é cobrada no processamento)', () => {
    const { situacao_veiculo, ...semSituacao } = apontamentoValido();
    expect(validarApontamento(semSituacao, HOJE)).toEqual([]);
  });

  test('custo zero é aceito na entrada (é cobrado no processamento)', () => {
    expect(validarApontamento({ ...apontamentoValido(), custo: 0 }, HOJE)).toEqual([]);
  });

  test('acumula todos os erros de um corpo vazio', () => {
    expect(validarApontamento({}, HOJE)).toHaveLength(7);
  });

  test.each([
    [{ ordem: 'OP12345' }, /ordem/],
    [{ ordem: 'op000123' }, /ordem/],
    [{ quantidade: 0 }, /quantidade/],
    [{ quantidade: 1.5 }, /quantidade/],
    [{ quantidade: '1' }, /quantidade/],
    [{ custo: -0.01 }, /custo/],
    [{ custo: '100' }, /custo/],
    [{ modelo: '   ' }, /modelo/],
    [{ data_producao: '2026-03-11' }, /futura/],
    [{ hora_producao: '25:00' }, /hora_producao/],
  ])('rejeita %p', (alteracao, mensagem) => {
    const erros = validarApontamento({ ...apontamentoValido(), ...alteracao }, HOJE);
    expect(erros).toHaveLength(1);
    expect(erros[0]).toMatch(mensagem);
  });
});

describe('avaliarProcessamento', () => {
  test('integra registro com custo e situação', () => {
    expect(avaliarProcessamento({ custo: 10, situacao_veiculo: 'PRODUZIDO' })).toEqual({ status: 'INTEGRADO', motivos: [] });
  });

  test('custo zero gera erro', () => {
    expect(avaliarProcessamento({ custo: 0, situacao_veiculo: 'PRODUZIDO' }).motivos).toEqual([MOTIVOS.CUSTO_ZERO]);
  });

  test.each(['', '   ', null])('situação vazia (%p) gera erro', (situacao) => {
    expect(avaliarProcessamento({ custo: 10, situacao_veiculo: situacao }).motivos).toEqual([MOTIVOS.SITUACAO_VAZIA]);
  });

  test('acumula os dois motivos', () => {
    const r = avaliarProcessamento({ custo: 0, situacao_veiculo: '' });
    expect(r.status).toBe('ERRO');
    expect(r.motivos).toEqual([MOTIVOS.CUSTO_ZERO, MOTIVOS.SITUACAO_VAZIA]);
  });
});

describe('validarCorrecao', () => {
  const comErro = { status: 'ERRO' };

  test('permite corrigir custo e situação', () => {
    expect(validarCorrecao(comErro, { custo: 100, situacao_veiculo: 'PRODUZIDO' })).toBeNull();
  });

  test.each([
    [undefined, { custo: 1 }, 404],
    [{ status: 'INTEGRADO' }, { custo: 1 }, 409],
    [comErro, {}, 400],
    [comErro, { vin: 'X' }, 400],
    [comErro, { custo: -1 }, 400],
    [comErro, { custo: '10' }, 400],
    [comErro, { situacao_veiculo: 1 }, 400],
  ])('registro %p + %p => HTTP %i', (registro, alteracoes, http) => {
    expect(validarCorrecao(registro, alteracoes).http).toBe(http);
  });
});
