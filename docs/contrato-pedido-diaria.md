# Contrato do pedido de diária (`pedido-diaria`)

Este é o formato que o site SISBANDA manda ao Agent e que o **Pedido de teste** da
janela do Agent também usa. Os dois caminhos passam pelo mesmo validador
(`src/modules/pedidoDiaria/contrato.js`) e pela mesma fila de jobs.
`test/contrato.test.js` valida o exemplo abaixo: se este documento e o código
divergirem, o teste quebra.

Versão do protocolo: `3` (campo `protocol` de `GET /version`).

## Requisição

```
POST http://localhost:9876/api/run
Origin: https://pcpb.sisbanda.com.br        (precisa estar em allowedOrigins)
Authorization: Bearer <token>               (JWT de GET /api/automacao/agent-token do backend,
                                             assinado com o mesmo segredo de jwtSecret do config.json)
Content-Type: application/json
```

Corpo: `{ "module": "pedido-diaria", "payload": <payload> }`

## Payload

```json
{
  "requisitante": "NOME DO REQUISITANTE COMO NO SEAD",
  "objetivo": "PARTICIPAR DE EVENTO",
  "justificativa": "Texto que vai para a aba JUSTIFICATIVA.",
  "tipoViagem": "estadual",
  "destinoUF": "PB",
  "destinoCidade": "Campina Grande",
  "dataSaida": "2026-11-23T08:00",
  "dataRetorno": "2026-11-23T18:00",
  "integrantes": [
    { "nome": "NOME COMPLETO DO INTEGRANTE", "cidadeOrigem": "João Pessoa" }
  ]
}
```

| Campo | Tipo | Obrigatório | Regra |
|---|---|---|---|
| `requisitante` | texto | sim | nome como aparece no SEAD (campo Requisitante). |
| `objetivo` | texto | sim | opção do select Objetivo do SEAD (valor ou rótulo). |
| `justificativa` | texto | sim | texto final da aba JUSTIFICATIVA. O site decide qual é. |
| `tipoViagem` | texto | sim | `estadual`, `nacional` ou `internacional` (maiúsculas ou minúsculas). |
| `destinoUF` | texto | sim | sigla de UF (`PB`, `PE`...). |
| `destinoCidade` | texto | sim | nome da cidade como aparece no SEAD; o Agent procura sem acento e sem diferenciar maiúsculas. |
| `dataSaida` | texto | sim | `AAAA-MM-DDTHH:mm`, hora local, sem fuso e sem segundos. Data de calendário válida. |
| `dataRetorno` | texto | sim | mesmo formato; não pode ser anterior a `dataSaida`. |
| `integrantes` | lista | sim, ≥ 1 | um item por integrante; o Agent abre uma janela do navegador para cada um. |
| `integrantes[].nome` | texto | sim | nome completo como aparece no SEAD (campo Requisitado). |
| `integrantes[].cidadeOrigem` | texto | sim | cidade de origem (Paraíba). O site resolve: lotação do integrante ou a sua cidade padrão. |

Texto é aparado; texto vazio conta como faltando. Qualquer campo obrigatório
faltando → `400`, antes de qualquer navegador abrir. O Agent não tem valor padrão
para nenhum campo. Campos desconhecidos são ignorados.

O estado de origem é sempre Paraíba, como na automação do Linux.

### O que NÃO vem no payload

Usuário e senha do SEAD: ficam só no cofre do Agent (cifrado pelo Windows),
configurados na janela do próprio Agent, e nunca passam pelo site.

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
fechadas pelo usuário. Termina em `error` se as credenciais não estiverem
configuradas (falha antes de abrir o navegador) ou se algum integrante não pôde
ser preenchido.

**A automação nunca salva o pedido no SEAD.** Ela preenche, mostra o aviso e para;
quem confere e clica em Salvar é o usuário.

## Prontidão (`GET /status`)

Antes de mandar um pedido, o site pode conferir um booleano — nunca os valores:

- `credenciaisConfiguradas`: há usuário e senha do SEAD guardados neste Agent.
