const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const yaml = require('js-yaml');
const swaggerUi = require('swagger-ui-express');
const { criarBanco } = require('./db');
const regras = require('./regras');

const CAMINHO_SPEC = path.join(__dirname, '..', 'openapi.yaml');

/**
 * Cria a aplicação. Relógio e chave de API são injetáveis para os testes.
 */
function criarApp({ agora = () => new Date(), apiKey = process.env.API_KEY || 'chave-dev', db } = {}) {
  const banco = db || criarBanco();
  const app = express();
  app.use(express.json());

  const iso = () => agora().toISOString().slice(0, 19);
  const buscar = (id) => banco.prepare('SELECT * FROM integracoes WHERE id = ?').get(id);

  // ---------- Documentação ----------
  const spec = yaml.load(fs.readFileSync(CAMINHO_SPEC, 'utf8'));
  app.get('/openapi.yaml', (req, res) => res.type('text/yaml').sendFile(CAMINHO_SPEC));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));

  app.get('/api/saude', (req, res) => res.json({ status: 'ok' }));

  // ---------- Autenticação ----------
  app.use('/api/integracoes', (req, res, next) => {
    if (req.get('x-api-key') !== apiKey) return res.status(401).json({ erro: 'Chave de API ausente ou inválida' });
    next();
  });

  // ---------- Integrações ----------

  app.post('/api/integracoes', (req, res) => {
    const dados = req.body || {};
    const erros = regras.validarApontamento(dados, agora());
    if (erros.length) return res.status(400).json({ erros });

    const existente = banco.prepare('SELECT id FROM integracoes WHERE ordem = ? AND vin = ?').get(dados.ordem, dados.vin);
    if (existente) {
      return res.status(409).json({ erro: `Apontamento já recebido para esta ordem e VIN (id ${existente.id})` });
    }

    const { lastInsertRowid } = banco
      .prepare(
        `INSERT INTO integracoes
           (ordem, vin, modelo, quantidade, custo, situacao_veiculo, data_producao, hora_producao, recebido_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        dados.ordem,
        dados.vin,
        dados.modelo.trim(),
        dados.quantidade,
        dados.custo,
        (dados.situacao_veiculo || '').trim(),
        dados.data_producao,
        regras.formatarHora(dados.hora_producao), // normaliza na entrada (correção do BUG-001)
        iso(),
      );
    res.status(201).location(`/api/integracoes/${lastInsertRowid}`).json(buscar(Number(lastInsertRowid)));
  });

  app.get('/api/integracoes', (req, res) => {
    const { status, modelo } = req.query;
    const pagina = req.query.pagina === undefined ? 1 : Number(req.query.pagina);
    const limite = req.query.limite === undefined ? 20 : Number(req.query.limite);

    const erros = [];
    if (status !== undefined && !Object.values(regras.STATUS).includes(String(status).toUpperCase())) {
      erros.push(`status deve ser um de: ${Object.values(regras.STATUS).join(', ')}`);
    }
    if (!Number.isInteger(pagina) || pagina < 1) erros.push('pagina deve ser um inteiro maior que zero');
    if (!Number.isInteger(limite) || limite < 1 || limite > 100) erros.push('limite deve ser um inteiro entre 1 e 100');
    if (erros.length) return res.status(400).json({ erros });

    const condicoes = [];
    const params = [];
    if (status) {
      condicoes.push('status = ?');
      params.push(String(status).toUpperCase());
    }
    if (modelo) {
      condicoes.push('modelo = ?');
      params.push(String(modelo));
    }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

    const { total } = banco.prepare(`SELECT COUNT(*) AS total FROM integracoes ${where}`).get(...params);
    const dados = banco
      .prepare(`SELECT * FROM integracoes ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, limite, (pagina - 1) * limite);

    res.json({ dados, pagina, limite, total });
  });

  // Precisa vir antes de "/:id" para não ser capturada como id
  app.post('/api/integracoes/processar', (req, res) => {
    const pendentes = banco.prepare("SELECT * FROM integracoes WHERE status = 'PENDENTE' ORDER BY id").all();
    const atualizar = banco.prepare(
      'UPDATE integracoes SET status = ?, motivo_erro = ?, processado_em = ?, tentativas = tentativas + 1 WHERE id = ?',
    );
    const quando = iso();
    let integrados = 0;
    let comErro = 0;

    banco.exec('BEGIN');
    try {
      for (const reg of pendentes) {
        const { status, motivos } = regras.avaliarProcessamento(reg);
        atualizar.run(status, motivos.length ? motivos.join('; ') : null, quando, reg.id);
        if (status === regras.STATUS.INTEGRADO) integrados += 1;
        else comErro += 1;
      }
      banco.exec('COMMIT');
    } catch (e) {
      banco.exec('ROLLBACK');
      throw e;
    }
    res.json({ processados: pendentes.length, integrados, erros: comErro });
  });

  app.get('/api/integracoes/:id', (req, res) => {
    const reg = buscar(Number(req.params.id));
    if (!reg) return res.status(404).json({ erro: 'Integração não encontrada' });
    res.json(reg);
  });

  app.patch('/api/integracoes/:id', (req, res) => {
    const reg = buscar(Number(req.params.id));
    const alteracoes = req.body || {};
    const problema = regras.validarCorrecao(reg, alteracoes);
    if (problema) return res.status(problema.http).json({ erro: problema.erro });

    const campos = Object.keys(alteracoes);
    const sets = campos.map((c) => `${c} = ?`).join(', '); // nomes vêm da lista fixa CAMPOS_CORRIGIVEIS
    const valores = campos.map((c) => (typeof alteracoes[c] === 'string' ? alteracoes[c].trim() : alteracoes[c]));
    banco.prepare(`UPDATE integracoes SET ${sets} WHERE id = ?`).run(...valores, reg.id);
    res.json(buscar(reg.id));
  });

  app.post('/api/integracoes/:id/reprocessar', (req, res) => {
    const reg = buscar(Number(req.params.id));
    if (!reg) return res.status(404).json({ erro: 'Integração não encontrada' });
    if (reg.status !== regras.STATUS.ERRO) {
      return res.status(409).json({ erro: `Só é possível reprocessar registros com erro (status atual: ${reg.status})` });
    }
    banco
      .prepare("UPDATE integracoes SET status = 'PENDENTE', motivo_erro = NULL, processado_em = NULL WHERE id = ?")
      .run(reg.id);
    res.json(buscar(reg.id));
  });

  // ---------- Painel ----------

  app.get('/api/painel', (req, res) => {
    const totais = { PENDENTE: 0, INTEGRADO: 0, ERRO: 0 };
    banco
      .prepare('SELECT status, COUNT(*) AS qtd FROM integracoes GROUP BY status')
      .all()
      .forEach((l) => {
        totais[l.status] = l.qtd;
      });

    const erros = banco.prepare("SELECT motivo_erro FROM integracoes WHERE status = 'ERRO'").all();
    const contagem = {};
    erros.forEach(({ motivo_erro }) =>
      String(motivo_erro)
        .split('; ')
        .forEach((m) => {
          contagem[m] = (contagem[m] || 0) + 1;
        }),
    );
    const erros_por_motivo = Object.entries(contagem)
      .map(([motivo, quantidade]) => ({ motivo, quantidade }))
      .sort((a, b) => b.quantidade - a.quantidade || a.motivo.localeCompare(b.motivo));

    const ultima = banco
      .prepare(
        `SELECT vin, modelo, data_producao, hora_producao FROM integracoes
          WHERE status = 'INTEGRADO'
          ORDER BY data_producao DESC, hora_producao DESC, id DESC LIMIT 1`,
      )
      .get();

    res.json({
      totais,
      erros_por_motivo,
      ultima_integracao: ultima
        ? { vin: ultima.vin, modelo: ultima.modelo, data: ultima.data_producao, hora: ultima.hora_producao }
        : null,
    });
  });

  app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' });
    console.error(err);
    res.status(500).json({ erro: 'Erro interno' });
  });

  return app;
}

module.exports = { criarApp };
