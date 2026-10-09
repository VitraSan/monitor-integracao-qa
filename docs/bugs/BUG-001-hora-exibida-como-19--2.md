# BUG-001: Hora da última integração exibida como "19::2"

| Campo | Valor |
|---|---|
| Severidade | Média |
| Prioridade | Média |
| Componente | Painel: card "Última integração" |
| Status | Corrigido, com teste de regressão |
| Origem | Defeito real encontrado no sistema original (dados anonimizados) |

## Descrição

O card de última integração do painel mostrava a hora quebrada, por exemplo **"19::2"** em vez de **"19:25"**. Quem acompanha a integração usa esse card para saber se o fluxo MES → ERP está parado, e a informação ficava ilegível.

## Passos para reproduzir

1. Enviar um apontamento com `hora_producao` = `"19:25"`.
2. Processar a fila.
3. Abrir o painel (`GET /api/painel`).

**Resultado esperado:** `ultima_integracao.hora` = `"19:25"`
**Resultado obtido:** `"19::2"`

## Causa raiz

A tela assumia que a hora vinha do banco no formato `HHMM` e montava a exibição recortando o texto:

```
primeiros 2 caracteres + ":" + caracteres 3 e 4
```

Só que o campo já vinha gravado como `HH:MM`. Com `"19:25"`, os primeiros 2 caracteres são `19` e os caracteres 3 e 4 são `:2`, o que resulta em `19` + `:` + `:2` = **`19::2`**.

O problema real era a **falta de um formato único**: cada origem gravava a hora de um jeito, e a tela tratava só um dos casos.

## Correção

- A hora é **normalizada na entrada** pela função `formatarHora` (`src/regras.js`), que aceita `HHMM` e `HH:MM` e sempre grava `HH:MM`.
- Horas inválidas (`24:00`, `23:60`, `7:05`, `19::25`) são rejeitadas com HTTP 400.
- O contrato (`openapi.yaml`) passou a exigir o padrão `HH:MM` na resposta, então qualquer formato diferente quebra o teste de contrato.

## Testes de regressão

| Onde | Teste |
|---|---|
| `tests/unit/regras.test.js` | `[BUG-001] mantém a hora que já chega como HH:MM` e `[BUG-001] insere os dois-pontos quando chega como HHMM` |
| `tests/api/integracoes.test.js` | `[BUG-001] hora enviada como HHMM é normalizada` e `[BUG-001] última integração exibe a hora correta` |
| Coleção Postman | `[BUG-001] Hora no formato HHMM é normalizada` e `última integração com hora HH:MM (BUG-001)` |

Reintroduzindo de propósito a lógica antiga de recorte, 11 testes falham.
