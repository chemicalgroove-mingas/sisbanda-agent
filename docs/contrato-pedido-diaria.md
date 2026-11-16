# Contrato do pedido de diária (`pedido-diaria`)

Este é o formato que o site SISBANDA manda ao Agent (a partir da fase A3) e que o
**Pedido de teste** da janela do Agent já usa. Os dois caminhos passam pelo mesmo
validador (`src/modules/pedidoDiaria/contrato.js`) e pela mesma fila de jobs.
`test/contrato.test.js` valida o exemplo abaixo: se este documento e o código
divergirem, o teste quebra.

Versão do protocolo: `2` (campo `protocol` de `GET /version`).

## Requisição

```
POST http://localhost:9876/api/run
Origin: https://pcpb.sisbanda.com.br        (precisa estar em allowedOrigins)
Authorization: Bearer <token>               (esquema do token: fase A3)
Content-Type: application/json
```

Corpo: `{ "module": "pedido-diaria", "payload": <payload> }`

## Payload

```json
{
  "tipoViagem": "estadual",
  "destinoUF": "PB",
  "destinoCidade": "Campina Grande",
  "dataSaida": "2026-11-23T08:00",
  "dataRetorno": "2026-11-23T18:00",
  "justificativa": null,
  "integrantes": [
    { "nome": "NOME COMPLETO DO INTEGRANTE", "lotacao": null }
  ]
}
```

| Campo | Tipo | Obrigatório | Regra |
|---|---|---|---|
| `tipoViagem` | texto | sim | `estadual`, `nacional` ou `internacional` (maiúsculas ou minúsculas). É o mesmo valor que o site já guarda no pedido. |
| `destinoUF` | texto | sim | sigla de UF (`PB`, `PE`...). |
| `destinoCidade` | texto | sim | nome da cidade como aparece no SEAD; o Agent procura sem acento e sem diferenciar maiúsculas. |
| `dataSaida` | texto | sim | `AAAA-MM-DDTHH:mm`, hora local, sem fuso e sem segundos. Data de calendário válida. |
| `dataRetorno` | texto | sim | mesmo formato; não pode ser anterior a `dataSaida`. |
| `justificativa` | texto ou `null` | não | texto digitado no pedido. Vazio ou `null` → o Agent usa a **justificativa padrão** da sua configuração (D4). No site corresponde a `observacoes`. |
| `integrantes` | lista | sim, ≥ 1 | um item por integrante; o Agent abre uma janela do navegador para cada um. |
| `integrantes[].nome` | texto | sim | nome completo como aparece no SEAD. |
| `integrantes[].lotacao` | texto ou `null` | não | cidade de lotação. Vazia ou `null` → o Agent usa a **cidade de origem padrão** da sua configuração. |

Campos desconhecidos são ignorados.

### O que NÃO vem no payload

Vem da configuração de cada Agent, feita na janela do próprio Agent:

- usuário e senha do SEAD (cofre cifrado pelo Windows; nunca passam pelo site);
- requisitante;
- objetivo (padrão `PARTICIPAR DE EVENTO`);
- justificativa padrão;
- cidade de origem padrão.

## Respostas

| Status | Corpo | Quando |
|---|---|---|
| 202 | `{ "jobId": "<uuid>", "status": "pending" }` | job criado |
| 400 | `{ "error": "Payload inválido.", "detalhes": ["...", "..."] }` | payload fora deste contrato |
| 400 | `{ "error": "Campo \"module\" é obrigatório." }` | sem `module` |
| 401 | `{ "error": "Token ausente." }` / `{ "error": "Token inválido ou expirado." }` | token |
| 403 | `{ "error": "Origem não permitida." }` | `Origin` fora de `allowedOrigins` (inclusive no preflight) |
| 404 | `{ "error": "Módulo ... não encontrado.", "available": [...] }` | módulo inexistente |
| 409 | `{ "error": "Agent ocupado. ..." }` | já existe job pendente ou rodando |

## Acompanhamento

- WebSocket `ws://localhost:9876` (mesma regra de origem): eventos `job_started`,
  `step` (`{ jobId, module, message }`), `job_finished` ou `job_error` (`{ jobId, error }`).
- `GET /jobs/<jobId>`: `status` (`pending` | `running` | `done` | `error`), `steps`, `error`.

O job só termina quando todas as janelas do navegador abertas pela automação forem
fechadas pelo usuário. Termina em `error` se a configuração estiver incompleta
(falha antes de abrir o navegador) ou se algum integrante não pôde ser preenchido.

**A automação nunca salva o pedido no SEAD.** Ela preenche, mostra o aviso e para;
quem confere e clica em Salvar é o usuário.

## Prontidão (`GET /status`)

Antes de mandar um pedido, o site pode conferir dois booleanos — nunca os valores:

- `credenciaisConfiguradas`: há usuário e senha do SEAD guardados neste Agent;
- `requisitanteConfigurado`: o requisitante foi informado.
