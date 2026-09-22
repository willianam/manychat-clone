# Mapa do código

Este documento existe para uma pergunta só: **onde eu mexo quando quero mudar
X?** Não é um catálogo de arquivos. Se um arquivo não aparece aqui, é porque
você provavelmente não precisa abri-lo no primeiro mês.

Todo o código fica em `app/src`. Três pastas importam:

| pasta | o que é | regra |
| --- | --- | --- |
| `src/lib/` | lógica pura, sem banco e sem rede | dá para testar sem nada ligado |
| `src/server/` | tudo que toca Prisma ou a API da Meta | só roda no servidor |
| `src/app/` | páginas, server actions e rotas de API (App Router) | é a fronteira com o navegador e com a Meta |

---

## O caminho de uma mensagem

Alguém manda "oi" no seu DM. O que acontece, em ordem:

```
Meta  ──POST──▶  src/app/api/webhook/instagram/route.ts
                      │  1. confere a assinatura HMAC do corpo cru
                      │  2. reivindica cada evento como uma linha WebhookEvent (dedup)
                      ▼
                 src/server/webhook-events.ts
                      │  normaliza o evento, acha/cria o Contact
                      ▼
                 src/server/trigger-dispatch.ts
                      │  decide o que o evento deve fazer
                      ▼
                 src/server/flow-runner.ts
                      │  executa o grafo do fluxo, nó a nó
                      ▼
                 src/server/instagram.ts
                      │  POST em graph.instagram.com
                      ▼
                    a DM sai
```

**`route.ts`** lê `await req.text()` antes de qualquer parse. Isso não é
estilo: a assinatura é um HMAC sobre os bytes crus, e um `JSON.parse` seguido
de `JSON.stringify` reordena as chaves e quebra o digest para sempre.

**`trigger-dispatch.ts`** é onde mora a prioridade, e a ordem é deliberada.
Palavra-chave global primeiro ("parar" tem que funcionar mesmo no meio de uma
pergunta). Depois, se o contato está parado numa pergunta, a mensagem é a
resposta dela. Só então os gatilhos são testados, para que um "sim" respondendo
a uma pergunta não dispare o fluxo da palavra "sim". Quer mudar quem ganha de
quem, é aqui.

**`flow-runner.ts`** é o motor. A invariante que segura tudo: todo `await` que
toca o mundo externo é seguido de uma escrita de estado, então um crash retoma
do último nó concluído em vez de reenviar mensagens. Há um teto de 50 passos
por execução (guarda contra ciclo no grafo) e de 5 saltos de "Ir para".

**`src/lib/flow-schema.ts`** define o que um fluxo *é*: os 18 tipos de nó
(mensagem, pergunta, resposta rápida, carrossel, imagem, vídeo, áudio, arquivo,
álbum, condição, delay, ação, aleatório, tag, ir-para, meta, requisição, fim) e
a validação estrutural do grafo, em Zod. **Nó novo se adiciona aqui primeiro**,
depois no runner, depois no editor (`src/components/nodes.tsx` e
`src/components/FlowEditor.tsx`).

---

## Por que existem três caminhos de trabalho de fundo

Um fluxo pode ter um nó de delay ("espere 30 minutos"). Alguém precisa acordar
essa sessão depois. Um disparo tem centenas de destinatários e não cabe numa
requisição. Esse trabalho é sempre o mesmo conjunto de tarefas — retomar delays
vencidos, varrer sessões abandonadas, empurrar um disparo, renovar o token,
consolidar estatísticas — e ele tem três portas de entrada:

| caminho | arquivo | quando roda | para que serve |
| --- | --- | --- | --- |
| **webhook** | `drainDueWork()` em `api/webhook/instagram/route.ts` | a cada mensagem recebida | é o caminho principal: uma conta que recebe DM drena a própria fila |
| **cron** | `api/cron/tick/route.ts` | 1×/dia na Vercel (`vercel.json`) | o piso para uma conta parada |
| **worker** | `src/server/worker-entry.ts` | laço de 5s, no docker-compose ou numa VPS | o único caminho com tempo confiável para delays curtos |

Os três chamam as mesmas funções de `src/server/broadcast-worker.ts`. A
diferença é o **orçamento de tempo**: o webhook drena com
`WEBHOOK_DRAIN_BUDGET_MS` (9s contra o `maxDuration = 15`), o cron com
`CRON_DRAIN_BUDGET_MS` (45s contra 60), e o worker sem orçamento nenhum —
uma máquina que segura um laço não precisa parar no meio. Ao parar por
orçamento, o drain **devolve o lock** e o disparo volta a `QUEUED`, de onde o
próximo drainer continua. Ninguém recebe duas vezes: o `BroadcastRecipient` só
sai de `PENDING` depois do envio.

A consequência prática de tudo isso está no `DEPLOY.md`: no plano Hobby da
Vercel o cron roda uma vez por dia, então **numa conta parada um delay pode
atrasar até 24h**. Isso é decisão de plano, não limitação do código.

---

## Server action ou rota de API?

A regra do projeto é simples e vale a pena internalizar:

**Rota de API (`src/app/api/*/route.ts`) — só quando quem chama não é o seu
próprio painel.** São quatro, e cada uma tem um chamador externo:

- `webhook/instagram` — a Meta. Autentica por assinatura HMAC, nunca por senha.
- `cron/tick` — o agendador da Vercel. Autentica por `CRON_SECRET` no header,
  porque cron não manda cookie.
- `health` — monitor de uptime. Público, devolve status, nunca valores.
- `upload` — o navegador mandando um arquivo multipart, que server action não
  carrega bem.

**Server action (`"use server"`) para todo o resto.** São 18 arquivos
`actions.ts` espalhados por `src/app/**`, um por área do painel
(`contacts/actions.ts`, `flows/actions.ts`, `broadcasts/actions.ts`, ...). Uma
action é uma função do servidor chamada direto do formulário, sem rota, sem
`fetch`, sem cliente HTTP. Ela valida a entrada, chama algo de `src/server/` e
devolve `{ ok, error }` — falhas voltam como valor e viram toast, não `throw`
atravessando a fronteira.

As páginas em si são server components: leem o banco direto com Prisma, sem API
no meio. É por isso que não existe REST interno neste app.

**Autenticação é um lugar só**: `src/middleware.ts`. Tudo é bloqueado por
padrão, exceto uma lista curta de prefixos públicos (`/api/webhook`,
`/api/cron`, `/api/health`, `/login`, `/privacidade`, assets). Mexeu em rota
nova que precisa ser pública, é essa lista.

---

## Onde ficam os testes

105 arquivos, 748 testes, Vitest, todos rodando **sem credencial e sem banco** —
o Prisma é sempre um fake injetado. `npm test` numa máquina recém-clonada passa.

```
src/lib/__tests__/       27 arquivos  — lógica pura: janela de 24h, assinatura,
                                        validação de grafo, normalização de texto
src/server/__tests__/    47 arquivos  — runner, gatilhos, disparo, drain, recibos
src/components/__tests__ 12 arquivos  — editor, gráficos, componentes de UI
src/app/**/__tests__/    12 arquivos  — server actions e telas
src/lib/ui/__tests__/     6 arquivos  — toast, estado não salvo
```

O teste fica ao lado do que ele testa, num `__tests__` irmão. Convenção do
projeto: mexeu em `src/server/foo.ts`, o teste é `src/server/__tests__/foo.test.ts`.

Para simular um webhook local sem a Meta, veja a seção "testar sem a Meta" no
README — você assina o corpo com o seu próprio `IG_APP_SECRET` e faz um curl.

---

## As quatro regras da Meta que estão embutidas no código

Não são opcionais, e entender cada uma evita horas perdidas achando que é bug:

**Janela de 24h** (`src/lib/messaging-window.ts`). Mensagem livre só dentro de
24h da última mensagem recebida do contato. Fora disso a API recusa (erro 10,
subcódigo 2534022). O disparo filtra esses contatos antes e os reporta como
"pulados", em vez de gastar milhares de chamadas para colecionar milhares de
erros iguais.

**Resposta privada única.** Cada comentário permite exatamente uma resposta
privada, até 7 dias depois. É ela que abre a janela de 24h, por isso o
comment-to-DM a manda antes de o fluxo tentar qualquer coisa. Nesta API ela é um
`POST /me/messages` com `recipient: {comment_id}`.

**Retry agressivo.** A Meta reenvia qualquer webhook que demore mais que ~20s.
A rota responde rápido e a tabela `WebhookEvent` deduplica por id de entrega;
`reprocessFailed()` roda uma segunda vez o que falhou. Uma falha transitória
não perde a mensagem.

**Rate limit.** Disparos são paced em `BROADCAST_RATE` msg/s. Rajada leva a
throttle (erro 613) ou flag na conta.

---

## Modelo de dados, em uma respirada

`prisma/schema.prisma`, 25 modelos. Os que você vai abrir:

- `Contact`, `Tag`, `ContactTag`, `CustomField`/`ContactField` — quem é a pessoa.
- `Flow` (o grafo em JSON), `Trigger` (o que dispara: KEYWORD, COMMENT,
  STORY_REPLY, STORY_MENTION, REF, DEFAULT, WELCOME), `FlowSession` (onde cada
  contato parou).
- `Message` — o histórico, com `status` sempre andando para frente:
  PENDING → SENT → DELIVERED → READ.
- `Broadcast` / `BroadcastRecipient` — a fila de disparo.
- `WebhookEvent` — dedup e retry do que a Meta mandou. `IgCredential` — o token
  e sua validade.

Migração se cria com `npm run db:migrate` e se aplica em produção com
`npm run db:deploy`. Nunca edite uma migração já aplicada.
