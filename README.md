# ManyChat Clone — Instagram DM

Automação pessoal de DM do Instagram: fluxos conversacionais com editor
visual, gatilho por palavra-chave, comment-to-DM, contatos com tags e
broadcast segmentado. Roda local via Docker.

## Stack

Next.js 15 (App Router) · Prisma + Postgres · React Flow · TypeScript

## Rodar local

```bash
cp .env.example .env      # preencha DATABASE_URL, ADMIN_PASSWORD, CRON_SECRET
docker compose up -d db
npx prisma migrate dev --name init
npm run db:seed
npm run dev
```

## Deploy em produção (Vercel + Neon)

Ver **DEPLOY.md** para o passo a passo completo.

Na Vercel o `worker` do docker-compose não roda — funções serverless não
mantêm loop. O mesmo trabalho acontece em `/api/cron/tick`, chamado a cada
minuto pelo Vercel Cron (`vercel.json`). O docker-compose segue válido para
VPS ou uso local.

## Segurança

Tudo exceto `/api/webhook/*` e `/api/cron/*` fica atrás de uma senha única
(`ADMIN_PASSWORD`), aplicada em `src/middleware.ts`. Se a variável não
estiver definida em produção, o painel responde 503 e se tranca — o padrão
oposto exporia todos os contatos silenciosamente.

O webhook precisa continuar aberto: a Meta se autentica assinando o corpo
(HMAC), não carregando a nossa senha. O cron valida `CRON_SECRET` por conta
própria, porque o Vercel Cron não envia cookie.

---

## Passo a passo na Meta

Esta é a parte que nenhum código resolve. Reserve tempo: o app review leva
dias e é o caminho crítico do projeto.

### 1. Conta Instagram profissional

No app do Instagram: **Configurações → Tipo de conta → Mudar para conta
profissional**. Escolha Criador ou Empresa — qualquer um serve.

### 2. Página do Facebook — não é necessária

Este projeto usa a **API do Instagram com login do Instagram**
(`graph.instagram.com`), que dispensa Página do Facebook. Basta a conta
profissional do passo 1.

### 3. Criar o app

Em `developers.facebook.com/apps` → **Criar app** → tipo **Empresa**.
Depois **Adicionar produtos**: adicione **Instagram** e **Webhooks**.

### 4. Pegar as credenciais

Preencha o `.env` com:

| Variável | Onde achar |
|---|---|
| `IG_APP_SECRET` | Configurações → Básico → Chave secreta do app |
| `IG_VERIFY_TOKEN` | Você inventa. Qualquer string. Só precisa bater com o passo 5 |
| `IG_ACCESS_TOKEN` | Painel do app → API do Instagram → **Gerar tokens de acesso** |

O token do Explorer é de curta duração (cerca de 1h). Troque por um de
longa duração:

```bash
curl -G "https://graph.instagram.com/access_token" \
  -d "grant_type=ig_exchange_token" \
  -d "client_secret=SEU_APP_SECRET" \
  -d "access_token=TOKEN_CURTO"
```

### 5. Configurar o webhook

Em **Webhooks → Instagram → Assinar este objeto**:

- **URL de callback**: `https://xxxx.ngrok-free.app/api/webhook/instagram`
- **Token de verificação**: o mesmo `IG_VERIFY_TOKEN` do `.env`

Clique em **Verificar e salvar**. A Meta faz um GET de handshake na hora —
se o app não estiver rodando com o `.env` correto, falha aqui.

Depois **assine os campos**: `messages`, `messaging_postbacks` e `comments`.

### 6. Permissões e App Review

Em desenvolvimento, só funciona com contas listadas em **Funções do app**
(adicione a sua). Para funcionar com qualquer pessoa, precisa de review.

Permissões a solicitar:

- `instagram_basic`
- `instagram_manage_messages`
- `instagram_manage_comments` (necessária para comment-to-DM)
- `pages_manage_metadata`
- `pages_show_list`

A Meta pede um **vídeo de tela** mostrando o fluxo completo: alguém comenta
no post, recebe a DM, responde, e o fluxo continua. Grave com o sistema já
funcionando em modo desenvolvimento. Descreva o caso de uso como automação
de atendimento da própria conta — que é o que de fato é.

**Prazo realista**: alguns dias a algumas semanas, com chance de recusa e
reenvio. Comece por aqui, não pelo código.

---

## Regras da Meta embutidas no código

Estas não são opcionais e o sistema as respeita:

**Janela de 24h** (`src/lib/messaging-window.ts`). Só se pode enviar
mensagem livre dentro de 24h da última mensagem recebida do contato. Fora
disso a API rejeita (erro 10, subcódigo 2534022). O broadcast filtra esses
contatos antes de enviar e os reporta como "skipped", em vez de gastar
milhares de chamadas para colecionar milhares de erros iguais.

**Private reply único**. Cada comentário permite exatamente uma resposta
privada, até 7 dias após o comentário. É ela que abre a janela de 24h — por
isso o comment-to-DM a envia antes de o fluxo tentar qualquer coisa. Nesta
API ela é um `POST /me/messages` com `recipient: {comment_id}`.

**Assinatura do webhook** (`src/lib/verify-signature.ts`). Todo POST vem
assinado com HMAC-SHA256 sobre o corpo **cru**. Se um framework fizer parse
e re-serializar o JSON, a ordem das chaves muda e o digest nunca bate — por
isso a rota lê `await req.text()` primeiro. A comparação é constant-time.

**Retry agressivo**. A Meta reenvia qualquer webhook que demore mais que
~20s. A rota responde 200 na hora e processa em background; a tabela
`WebhookEvent` deduplica por id de entrega.

**Rate limit**. Broadcasts são paced em `BROADCAST_RATE` msg/s (padrão 5).
Rajada leva a throttle (erro 613) ou flag na conta.

## Estrutura

```
prisma/schema.prisma          modelo de dados
prisma/seed.ts                dados de exemplo
src/lib/flow-schema.ts        formato do fluxo + validação estrutural
src/lib/messaging-window.ts   regra das 24h
src/lib/verify-signature.ts   HMAC do webhook
src/server/flow-runner.ts     motor de execução
src/server/trigger-dispatch.ts  roteamento de gatilhos
src/server/instagram.ts       cliente da Graph API
src/server/broadcast-worker.ts  fila + rate limit
src/components/FlowEditor.tsx   canvas React Flow
src/app/api/webhook/instagram/  endpoint do webhook
docs/openapi.yaml             spec da API
```

## Testar sem a Meta

O motor de fluxo, a validação de grafo, a janela e a assinatura têm testes
que rodam sem nenhuma credencial:

```bash
npm test
```

Para simular um webhook local, assine o corpo com seu app secret:

```bash
BODY='{"entry":[{"messaging":[{"sender":{"id":"demo-ana"},"message":{"mid":"m1","text":"oi"}}]}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$IG_APP_SECRET" | awk '{print $2}')
curl -X POST localhost:3000/api/webhook/instagram \
  -H "Content-Type: application/json" \
  -H "x-hub-signature-256: sha256=$SIG" \
  -d "$BODY"
```

## Estado de verificação

O que foi executado nesta entrega:

- ✅ `npm test` — 15/15 passando (janela, assinatura, validação de grafo)
- ✅ `npx tsc --noEmit` — 0 erros
- ✅ `npx prisma validate` + `generate` — schema válido, client gerado
- ✅ `npm run build` — build de produção completo, 8 rotas + middleware
- ✅ Middleware verificado por requisição real: painel 307→/login, webhook
  200 com token certo / 403 com errado, cron 401 sem secret
- ⚠️ `prisma migrate` **não foi executado**: não há Docker nem servidor
  Postgres nesta máquina. A migração roda no primeiro deploy (DEPLOY.md).
- ⚠️ Nenhuma chamada real à Graph API foi feita — depende das credenciais
  que só existem após o app review.

## Pendências conhecidas

As rotas `/api/admin/*` descritas em `docs/openapi.yaml` ainda não foram
implementadas. O painel lê o banco direto via server components, então tudo
que você vê funciona — mas não há API REST para automação externa.
