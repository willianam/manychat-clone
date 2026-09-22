# ManyChat Clone — automação de DM do Instagram

Um painel que responde as DMs da **sua** conta de Instagram sozinho. Você
desenha o fluxo da conversa arrastando blocos, escolhe o que dispara (uma
palavra na DM, um comentário num post, uma resposta de story, um link), e o
sistema conversa por você: manda mensagem, faz pergunta, espera resposta,
ramifica por condição, põe tag no contato, chama uma API externa, espera 30
minutos e continua. Tem também caixa de entrada, base de contatos com tags e
campos personalizados, disparo segmentado e métricas.

**O que ele não é.** Não é um produto multi-inquilino: é uma instância, uma
conta de Instagram, uma senha. Não é uma fila de atendimento com vários
agentes. Não é ferramenta de crescimento — ele responde quem falou com você
primeiro, porque é o que a API da Meta permite. E não vem com credencial
nenhuma: você vai montar as suas, e a maior parte do trabalho deste README é
exatamente essa.

**Stack.** Next.js 16 (App Router) · React 19 · Prisma + Postgres ·
TypeScript · Tailwind + Radix · React Flow · Vitest.

> Se você quer entender **onde mexer** no código, o mapa está em
> [`docs/arquitetura.md`](docs/arquitetura.md). Para publicar na sua conta,
> [`DEPLOY.md`](DEPLOY.md).

---

## Antes de começar

Reserve um fim de semana, não uma tarde. O código sobe em quinze minutos; o
que consome tempo é a parte da Meta.

**Ordem que funciona:** suba local → veja os testes passando → crie o app na
Meta → conecte com um túnel → veja a primeira DM chegar. Publicar em produção
vem depois, e já com tudo funcionando.

O que você precisa ter:

| | |
| --- | --- |
| **Node 20 ou mais novo** | `node -v`. Foi desenvolvido no 22 e no 26; o Dockerfile usa `node:22-alpine`. |
| **npm** | vem com o Node. Não é projeto Bun nem pnpm — há um `package-lock.json`. |
| **Postgres** | o `docker-compose.yml` sobe um. Sem Docker, um Postgres local ou uma conta grátis no [neon.tech](https://neon.tech) servem igual. |
| **Uma conta de Instagram profissional** | Criador ou Empresa. A conta pessoal não serve. Como converter está na etapa 3. |
| **Uma conta no developers.facebook.com** | grátis. Não precisa de Página do Facebook (sério — veja a etapa 3.2). |
| **Um túnel HTTP** | ngrok, cloudflared, o que preferir. A Meta só manda webhook para `https://` público. |

---

## 1. Subir local

```bash
git clone <a-url-do-repositorio>
cd manychat-clone/app
npm install
cp .env.example .env
```

Abra o `.env`. Ele é longo de propósito: cada variável diz para que serve,
se é obrigatória e onde achar o valor. Para a tela de login abrir, só quatro
importam agora:

```bash
DATABASE_URL="postgresql://manychat:manychat@localhost:5432/manychat"
DIRECT_URL="postgresql://manychat:manychat@localhost:5432/manychat"
ADMIN_PASSWORD="$(openssl rand -base64 24)"   # anote o valor gerado
AUTH_SECRET="$(openssl rand -hex 32)"
```

(Com Postgres local as duas strings são iguais. No Neon são diferentes, e a
diferença importa — está explicada no `.env.example` e no `DEPLOY.md`.)

Suba o banco, crie as tabelas, plante os dados de exemplo e rode:

```bash
docker compose up -d db      # ou aponte para o seu Postgres
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Abra `http://localhost:3000`. Vai pedir a senha: é o `ADMIN_PASSWORD`. Dentro
você encontra duas tags, três contatos de mentira e um fluxo "Boas-vindas"
ligado à palavra "oi". Nada disso fala com o Instagram ainda.

**Confira que a base está sã antes de seguir:**

```bash
npm test          # 748 testes, nenhuma credencial necessária
npm run typecheck # 0 erros
```

Se esses dois passam, o problema seguinte não é o código — é configuração.

<details>
<summary>Deu errado?</summary>

**503 em vez da tela de login** — nem `ADMIN_PASSWORD` nem `AUTH_SECRET`
estão definidas. O painel tranca de propósito quando não há como autenticar;
o contrário exporia todos os contatos em silêncio.

**`P1001` no migrate** — o Postgres não respondeu. Com Docker,
`docker compose ps` e veja se o container `manychat-db` está `healthy`.

**`Environment variable not found: DIRECT_URL`** — o `schema.prisma` declara
as duas conexões. Preencha as duas, mesmo sendo iguais.
</details>

---

## 2. Entender o que você acabou de subir

Vale cinco minutos antes de entrar no labirinto da Meta.

- **Fluxos** — o canvas. Arraste blocos, ligue um no outro, publique.
- **Gatilhos** — o que faz um fluxo começar: palavra-chave na DM, comentário
  num post, resposta ou menção em story, link de ref, a primeira mensagem de
  alguém (boas-vindas), ou o fallback quando nada casou.
- **Contatos** — quem falou com você, com tags e campos personalizados.
- **Disparos** — mensagem para um segmento. Tem "enviar um teste" antes do
  envio real, e ele manda para um contato só, sem tocar na lista.
- **Insights** e **Caixa de entrada** — métricas e conversas ao vivo.

O caminho completo de uma mensagem, dos bytes que a Meta manda até a DM
saindo, está em [`docs/arquitetura.md`](docs/arquitetura.md).

---

## 3. Criar o app na Meta

Esta é a parte que trava todo mundo. Vá devagar.

> **Consultado em 21/09/2026** na documentação oficial da Meta
> (`developers.facebook.com/docs/instagram-platform/...` — a árvore está
> migrando para `/documentation/...`, os dois caminhos respondem hoje).
> Esta API já mudou de nome e de permissões mais de uma vez; se você achar
> um tutorial na internet falando em `instagram_basic` ou em token de Página,
> é de antes de janeiro de 2025 e não serve mais. Confira a data de qualquer
> instrução que contradiga esta.

### 3.1 Conta profissional

No app do Instagram: **Configurações → Tipo de conta e ferramentas → Mudar
para conta profissional**. Criador ou Empresa, tanto faz. Continua sendo
exigido em 2026.

### 3.2 Página do Facebook: não precisa

Este projeto usa a **API do Instagram com login do Instagram**
(`graph.instagram.com`). A documentação é explícita: essa configuração não
exige Página do Facebook vinculada. Se um tutorial mandar criar Página e pegar
um *Page Access Token*, ele está descrevendo o **outro** caminho (login com
Facebook, `graph.facebook.com`), que este código não fala. Os dois existem,
são incompatíveis, e misturá-los é a fonte número um de confusão aqui.

### 3.3 Criar o app

Em `developers.facebook.com/apps` → **Criar app**.

O painel hoje pergunta **o caso de uso** antes do tipo. Escolha o do
Instagram — em inglês, *"Manage messaging and content on Instagram"*. (A
documentação da Meta só publica os rótulos em inglês, então o texto em
português da sua tela pode variar; é o item que fala em mensagens e conteúdo
do Instagram.) Algumas páginas mais antigas ainda mandam escolher o tipo
**Empresa / Business**; as duas coisas convivem, o caso de uso é o que
importa.

### 3.4 Pegar as credenciais

| Variável | Onde achar |
| --- | --- |
| `IG_APP_SECRET` | **Configurações do app → Básico → Chave secreta do app** → "Mostrar" |
| `IG_VERIFY_TOKEN` | você inventa. Qualquer string. Só precisa bater com a etapa 3.5 |
| `IG_ACCESS_TOKEN` | veja abaixo |

Para o token: painel do app → **Instagram → API setup with Instagram business
login** → adicione a sua conta de Instagram → botão **"Generate token"** ao
lado dela.

**O token que sai desse botão já é de longa duração: vale 60 dias.** Não
precisa trocar por nada. (Se você em vez disso implementar o fluxo OAuth
completo, aí sim o token nasce com 1 hora de vida e precisa ser trocado:
`GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=SEU_SECRET&access_token=TOKEN_CURTO`.
O botão do painel pula essa etapa.)

Depois do primeiro uso, o app guarda o token no banco e o renova sozinho
quando faltam menos de 10 dias — a renovação exige que o token tenha pelo
menos 24h de idade, o que o tick respeita. Se falhar, a página
**/configuracoes** avisa, e só aí você gera outro.

Preencha as três no `.env` e reinicie o `npm run dev`.

### 3.5 Configurar o webhook

Primeiro exponha o seu localhost:

```bash
ngrok http 3000     # anote a url https que ele imprime
```

No painel do app, na seção **Webhooks** do caso de uso do Instagram:

- **Callback URL**: `https://SEU-TUNEL.ngrok-free.app/api/webhook/instagram`
- **Verify token**: exatamente o `IG_VERIFY_TOKEN` do seu `.env`

**Verificar e salvar**. A Meta faz um GET de handshake na hora. Se o app não
estiver rodando, ou o token não bater, ou a variável não estiver carregada,
falha aqui e a mensagem de erro é genérica. Teste você mesmo antes de clicar:

```bash
curl "https://SEU-TUNEL.ngrok-free.app/api/webhook/instagram?hub.mode=subscribe&hub.verify_token=SEU_TOKEN&hub.challenge=teste123"
# esperado: teste123
# 403 → o token não bate    503 → a variável não está no processo
```

Depois **assine os campos**:

| Campo | Para quê |
| --- | --- |
| `messages` | DMs, respostas e menções de story, links de ref. **Sem este, nada funciona.** |
| `messaging_postbacks` | toques em botão e em resposta rápida |
| `comments` | comment-to-DM |
| `messaging_seen` | recibo de leitura. Sem ele as mensagens ficam em "enviada" para sempre e a taxa de leitura do painel é zero |
| `messaging_referral` | links de ref que chegam por fora de uma mensagem |
| `message_reactions` | curtida numa mensagem (opcional) |

### 3.6 O passo que falta em quase todo tutorial

**Assinar os campos no painel não basta.** A Meta só começa a entregar eventos
depois que o *app* é inscrito na *conta*, e isso é uma chamada de API que
nenhuma tela da Meta faz por você. Quando falta, não dá erro: o webhook
verifica com 200, o painel fica verde e evento nenhum chega.

O app faz isso por você. Abra **Configurações → Conexão**, no bloco
**Inscrição do app na conta**: ele mostra o estado atual (inscrita, não
inscrita, ou "não foi possível consultar" quando a Meta não responde) e o
botão **Inscrever esta conta** faz a chamada. Repetir não duplica nada.

Se a Meta recusar, o aviso diz qual é a causa — token sem a permissão certa,
token expirado, ou conta que não é profissional — porque o conserto de cada
uma é outro.

<details>
<summary>Alternativa pelo terminal</summary>

```bash
curl -X POST "https://graph.instagram.com/v26.0/me/subscribed_apps" \
  -d "subscribed_fields=messages,messaging_postbacks,comments,messaging_seen,messaging_referral" \
  -d "access_token=$IG_ACCESS_TOKEN"
# esperado: {"success":true}
```

Conferir depois:

```bash
curl -G "https://graph.instagram.com/v26.0/me/subscribed_apps" \
  -d "access_token=$IG_ACCESS_TOKEN"
```

</details>

Se você mandar "oi" para a sua conta e **nada** acontecer, e o log do ngrok
não mostrar requisição nenhuma, é quase sempre isto: o webhook está salvo e
verificado, mas o app não está inscrito na conta.

### 3.7 Permissões e App Review

As permissões desta API se chamam hoje:

- `instagram_business_basic`
- `instagram_business_manage_messages`
- `instagram_business_manage_comments` (necessária para comment-to-DM)

Os nomes antigos (`instagram_basic`, `instagram_manage_messages`, e qualquer
`pages_*`) foram anunciados como substituídos em setembro de 2024 e
descontinuados em **27/01/2025**. Eles pertencem ao caminho de login com
Facebook. Não peça esses.

**A boa notícia:** para atender **a sua própria conta**, o Acesso Padrão já
cobre. **Você não precisa de App Review** — nem de vídeo, nem de verificação
de negócio, nem de espera. App Review só entra se um dia você for operar
contas de terceiros, e aí vêm junto a verificação de negócio, os screencasts
e as instruções passo a passo para o revisor.

---

## 4. A primeira DM

Com o app rodando, o túnel de pé, o webhook verificado e a conta inscrita:

1. No painel, abra **Fluxos → Boas-vindas** (veio do seed) e confirme que
   está publicado.
2. Em **Gatilhos**, confirme que a palavra-chave `oi` aponta para ele.
3. Do seu celular, em **outra** conta de Instagram, mande `oi` na DM da sua
   conta profissional.

Deve chegar a resposta do fluxo em segundos. No painel, o contato aparece em
**Contatos** e a conversa em **Caixa de entrada**.

Não chegou? Siga nesta ordem, que vai do mais comum ao mais raro:

1. **O ngrok recebeu algo?** Se não: abra **Configurações → Conexão** e veja o
   bloco **Inscrição do app na conta** (item 3.6).
2. **Recebeu, mas deu 401?** A assinatura não bateu — `IG_APP_SECRET` errado
   ou de outro app.
3. **Deu 200 e nada saiu?** Rode com `LOG_LEVEL=debug`. Provavelmente o
   gatilho não casou, e o contato cai em **Contatos → mensagens sem gatilho**.
4. **Log de erro de envio?** Veja `/configuracoes`: token expirado, ou o
   contato fora da janela de 24h.

A partir daqui vale ler [`docs/arquitetura.md`](docs/arquitetura.md) antes de
mudar qualquer coisa, e [`DEPLOY.md`](DEPLOY.md) quando quiser tirar o túnel
do caminho.

---

## Testar sem a Meta

O motor de fluxo, a validação de grafo, a janela de 24h e a assinatura têm
testes que rodam sem credencial nenhuma e sem banco:

```bash
npm test
```

Para forjar um webhook local, assine o corpo com o seu próprio app secret —
é exatamente o que a Meta faz:

```bash
BODY='{"entry":[{"messaging":[{"sender":{"id":"demo-ana"},"message":{"mid":"m1","text":"oi"}}]}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$IG_APP_SECRET" | awk '{print $2}')
curl -X POST localhost:3000/api/webhook/instagram \
  -H "Content-Type: application/json" \
  -H "x-hub-signature-256: sha256=$SIG" \
  -d "$BODY"
```

Isso dispara o fluxo de verdade contra o contato `demo-ana` do seed. O envio
para a Meta falha (o contato não existe lá), mas todo o resto do caminho é
exercitado e você vê a mensagem na caixa de entrada com erro de entrega.

---

## Comandos

```bash
npm run dev          # desenvolvimento
npm run build        # prisma generate + build de produção
npm start            # sobe o build
npm run worker       # laço de fundo (só fora da Vercel — veja arquitetura.md)
npm test             # 748 testes
npm run typecheck    # tsc --noEmit
npm run lint
npm run db:migrate   # cria migração nova (dev)
npm run db:deploy    # aplica migrações (produção)
npm run db:seed      # dados de exemplo
npm run db:studio    # navegador do banco
```

---

## Segurança, em um parágrafo cada

**O painel inteiro está atrás de uma senha** (`src/middleware.ts`), com três
exceções conscientes: o webhook (a Meta se autentica assinando o corpo, não
carregando a sua senha), o cron (valida `CRON_SECRET` sozinho, porque o
agendador não manda cookie) e `/api/health` e `/privacidade`, que precisam ser
públicos para monitor de uptime e para a revisão da Meta. Sem nenhuma das duas
variáveis de sessão, o painel tranca com 503 em vez de abrir.

**O cookie não é a senha.** É `expiração.hmac`, assinado com HMAC-SHA256 e
válido por 30 dias. Para deslogar todo mundo, rotacione `AUTH_SECRET`; trocar
só `ADMIN_PASSWORD` não desloga ninguém enquanto `AUTH_SECRET` existir.

**O login aceita 5 erros por IP a cada 15 minutos.** Atrás de proxy reverso
isso depende de `TRUST_PROXY=1` — a explicação completa está no `.env.example`
e é a pegadinha mais cara deste projeto. Na Vercel, nada a fazer.

**Logs são JSON em produção** e nunca carregam token: `/api/health` responde
dias restantes e se o último refresh falhou, jamais o valor.

---

## Pendência conhecida

`docs/openapi.yaml` descreve rotas `/api/admin/*` que **não existem**. O painel
lê o banco direto por server components, então tudo que você vê funciona — só
não há API REST para automação externa. O arquivo está desatualizado nessa
parte; trate-o como intenção antiga, não como contrato.
