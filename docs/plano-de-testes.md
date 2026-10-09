# Plano de Testes: Monitor de Integração MES → ERP

## 1. Objetivo

Garantir que os apontamentos de produção enviados pelo MES cheguem ao ERP de forma confiável:

- Nenhum dado inválido entra na fila.
- Nenhum apontamento é integrado em duplicidade.
- Registros com erro podem ser corrigidos e reprocessados.
- A API cumpre exatamente o que está documentado.

## 2. Escopo

| Dentro do escopo | Fora do escopo |
|---|---|
| Recebimento e validação dos apontamentos | Interface gráfica do painel |
| Idempotência (ordem + VIN) | ERP real (o processamento é simulado) |
| Processamento, correção e reprocessamento | Testes de carga |
| Filtros, paginação e painel | Gestão de chaves de API |
| Autenticação por chave | |
| Aderência ao contrato OpenAPI | |

## 3. Estratégia

| Camada | Ferramenta | Objetivo |
|---|---|---|
| Unitário | Jest | Regras puras: VIN, datas, hora, validações, processamento |
| API | Jest + Supertest | Fluxos HTTP completos com relógio e chave controlados |
| Contrato | Ajv + `openapi.yaml` | Toda resposta testada precisa estar documentada e bater com o schema, sem campos extras |
| Caixa-preta | Postman + Newman | Mesma API, vista de fora, com a coleção que o time usaria no dia a dia |

**Por que duas suítes de API?**

- **Jest** roda isolado, sem servidor, e controla o relógio. É a rede de segurança do desenvolvedor.
- **Postman/Newman** testa a aplicação rodando de verdade, como o consumidor da API veria. A coleção também serve de documentação executável.

## 4. Técnicas

- **Valor limite:** hora `00:00`, `23:59`, `24:00` e `23:60`; 29/02 em ano bissexto e não bissexto; `limite` 100 e 101; VIN com 16, 17 e 18 caracteres.
- **Partição de equivalência:** VIN com letras proibidas (I, O, Q), minúsculas e espaços.
- **Transição de estados:**

  ```
  PENDENTE → INTEGRADO
  PENDENTE → ERRO → (correção) → PENDENTE → INTEGRADO
  ```

  As transições proibidas também são testadas: corrigir ou reprocessar um registro INTEGRADO.
- **Teste de contrato:** o helper `toSatisfyContract` valida status e corpo contra o `openapi.yaml`.
- **Regressão rastreável:** os testes do BUG-001 são marcados com o ID em todas as camadas.
- **Mutação manual:** alterei um tipo na resposta e reintroduzi o bug antigo para confirmar que os testes falham.

## 5. Critérios de saída

- 100% das suítes passando no CI (Jest e Newman).
- Toda rota e todo status testado documentados no `openapi.yaml`.
- Nenhum defeito de severidade alta em aberto.

## 6. Riscos

| Risco | Mitigação |
|---|---|
| Documentação desatualizada em relação à API | Teste de contrato falha quando a resposta sai do schema |
| Coleção Postman dependente de dados de execuções anteriores | Ordem e VIN únicos gerados em pré-request; ids encadeados por variáveis |
| Formatos diferentes vindos do MES | Normalização na entrada e validação rígida com mensagens claras |
