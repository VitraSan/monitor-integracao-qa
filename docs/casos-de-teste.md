# Casos de Teste

Prioridade: **A** = alta, **M** = média, **B** = baixa.
Automação: **U** = unitário, **A** = API (Jest), **C** = contrato, **P** = Postman.

## Autenticação e disponibilidade

| ID | Cenário | Resultado esperado | Prio. | Automação |
|---|---|---|---|---|
| CT-01 | Requisição sem `x-api-key` | 401 | A | A, C, P |
| CT-02 | Chave inválida em POST | 401 e nada gravado | A | A |
| CT-03 | `/api/saude` e `/api/painel` sem chave | 200 (rotas públicas) | B | A, P |

## Recebimento de apontamentos

| ID | Cenário | Resultado esperado | Prio. | Automação |
|---|---|---|---|---|
| CT-10 | Apontamento válido | 201, status PENDENTE, header `Location` | A | A, C, P |
| CT-11 | Mesma ordem + VIN enviados duas vezes | 409 (idempotência) | A | A, C, P |
| CT-12 | Corpo vazio | 400 listando os 7 campos | M | U, A, P |
| CT-13 | VIN com 16 ou 18 caracteres, com I/O/Q, minúsculo ou com espaço | 400 | A | U, P |
| CT-14 | Quantidade 0, decimal ou texto | 400 | M | U |
| CT-15 | Custo negativo ou texto | 400 | M | U |
| CT-16 | Data inexistente (29/02 em ano não bissexto) ou futura | 400 | M | U |
| CT-17 | Hora `HHMM` | Gravada como `HH:MM` (BUG-001) | A | U, A, P |
| CT-18 | Hora `24:00`, `23:60`, `7:05` ou `19::25` | 400 | M | U, P |
| CT-19 | Custo zero ou situação vazia na entrada | Aceito (validado no processamento) | M | U |
| CT-20 | JSON malformado | 400, sem erro 500 | B | A, C |
| CT-21 | Texto com SQL no modelo | Gravado como texto, tabela intacta | A | A |

## Processamento

| ID | Cenário | Resultado esperado | Prio. | Automação |
|---|---|---|---|---|
| CT-30 | Registro com custo e situação | INTEGRADO | A | U, A, P |
| CT-31 | Custo zerado | ERRO "Custo zerado" | A | U, A, P |
| CT-32 | Custo zerado e situação vazia | ERRO com os dois motivos | M | U, A |
| CT-33 | Processar de novo | Não altera registros já processados | A | A |
| CT-34 | Resumo do processamento | integrados + erros = processados | M | A, P |

## Correção e reprocessamento

| ID | Cenário | Resultado esperado | Prio. | Automação |
|---|---|---|---|---|
| CT-40 | Fluxo erro → corrigir → reprocessar → processar | INTEGRADO com 2 tentativas | A | A, P |
| CT-41 | Corrigir registro INTEGRADO | 409 | A | U, A, P |
| CT-42 | Corrigir campo não permitido (ex.: VIN) | 400 | A | U, A |
| CT-43 | Reprocessar registro que não está com erro | 409 | M | A, P |
| CT-44 | Buscar, corrigir ou reprocessar id inexistente | 404 | B | A, P |

## Consulta e painel

| ID | Cenário | Resultado esperado | Prio. | Automação |
|---|---|---|---|---|
| CT-50 | Paginação | Total correto, ordem do mais novo para o mais antigo | M | A, C |
| CT-51 | Página além do fim | 200 com lista vazia | B | A |
| CT-52 | Filtro por status (sem diferenciar maiúsculas) e por modelo | Só os registros do filtro | M | A |
| CT-53 | Status inválido, `pagina=0`, `limite=101` ou `limite=abc` | 400 | M | A, C, P |
| CT-54 | Painel sem dados | Totais zerados e `ultima_integracao` nula | B | A, C |
| CT-55 | Painel com dados | Totais por status e erros por motivo ordenados | A | A, C, P |
| CT-56 | Última integração com horas em formatos diferentes | Hora `HH:MM` do último produzido (BUG-001) | A | A, C, P |

## Documentação

| ID | Cenário | Resultado esperado | Prio. | Automação |
|---|---|---|---|---|
| CT-60 | `/openapi.yaml` e `/docs` | Publicados | B | A |
| CT-61 | Rota inexistente | 404 em JSON | B | A |
