const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
-- Fila de integração: o MES grava, o ERP processa
CREATE TABLE integracoes (
  id               INTEGER PRIMARY KEY,
  ordem            TEXT NOT NULL,
  vin              TEXT NOT NULL,
  modelo           TEXT NOT NULL,
  quantidade       INTEGER NOT NULL CHECK (quantidade > 0),
  custo            REAL NOT NULL CHECK (custo >= 0),
  situacao_veiculo TEXT NOT NULL DEFAULT '',
  data_producao    TEXT NOT NULL,     -- AAAA-MM-DD
  hora_producao    TEXT NOT NULL,     -- como o MES enviou: HH:MM ou HHMM
  status           TEXT NOT NULL DEFAULT 'PENDENTE'
                   CHECK (status IN ('PENDENTE', 'INTEGRADO', 'ERRO')),
  motivo_erro      TEXT,
  tentativas       INTEGER NOT NULL DEFAULT 0,
  recebido_em      TEXT NOT NULL,
  processado_em    TEXT,
  UNIQUE (ordem, vin)
);

CREATE INDEX idx_integracoes_status ON integracoes (status);
`;

function criarBanco() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}

module.exports = { criarBanco };
