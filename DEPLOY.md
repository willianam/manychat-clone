# Deploy em produção — Vercel + Neon

Tempo estimado: ~1h para estar no ar. O App Review da Meta é o que demora
(dias a semanas) e vem **depois** — você precisa do sistema público para
gravar o vídeo que eles exigem.

---

## Parte 1 — Banco no Neon (10 min)

1. Crie conta em `neon.tech` → **New Project** → nome `manychat`, região
   mais próxima de você.

2. Em **Connection Details**, copie as **duas** strings:

   - A que tem `-pooler` no host → vai ser `DATABASE_URL`
   - A direta, sem `-pooler` → vai ser `DIRECT_URL`

   As duas são necessárias. Funções serverless abrem uma conexão por
   invocação e esgotariam o limite direto em minutos; já o Prisma Migrate
   não funciona através do pooler. Por isso o schema declara as duas.

3. Rode a migração a partir da sua máquina, apontando para o Neon:

   ```bash
   cd app
   cp .env.example .env
   # preencha DATABASE_URL e DIRECT_URL com as strings do Neon
   npx prisma migrate deploy
   npm run db:seed        # opcional: dados de exemplo
   ```

---

## Parte 2 — Deploy na Vercel (15 min)

1. Suba o código para o GitHub:

   ```bash
   cd app
   git init && git add -A
   git commit -m "ManyChat clone"
   gh repo create manychat-clone --private --source=. --push
   ```

2. Em `vercel.com` → **Add New → Project** → importe o repositório.
   Framework Next.js é detectado sozinho. **Não faça deploy ainda.**

3. Em **Environment Variables**, adicione todas antes do primeiro build:

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | string **pooled** do Neon |
   | `DIRECT_URL` | string **direta** do Neon |
   | `ADMIN_PASSWORD` | `openssl rand -base64 24` |
   | `CRON_SECRET` | `openssl rand -hex 32` |
   | `IG_APP_SECRET` | preencha na Parte 4 |
   | `IG_VERIFY_TOKEN` | string que você inventa |
   | `IG_ACCESS_TOKEN` | preencha na Parte 4 |
   | `GRAPH_API_VERSION` | `v26.0` |
   | `BROADCAST_RATE` | `5` |
   | `ACCOUNT_TIMEZONE` | `America/Sao_Paulo` (janelas de delay e agendamentos são lidos neste fuso) |

   As três da Meta podem ficar vazias por ora — o painel sobe sem elas.
   `ADMIN_PASSWORD` **não** pode: sem ela o painel se tranca com 503.

4. **Deploy**. Ao terminar você recebe `https://manychat-clone-xxx.vercel.app`.

5. Abra a URL: deve pedir a senha. Entre e confira o painel.
   O Vercel Cron já está ativo via `vercel.json` (uma vez por dia, às 09:00
   UTC — o limite do plano Hobby). No dia a dia quem drena a fila é o
   próprio webhook, a cada mensagem recebida; veja "Deploy em produção" no
   README.

---

## Parte 3 — Conta e app na Meta (20 min)

### 3.1 Conta profissional
Instagram → **Configurações → Tipo de conta → Mudar para profissional**.
Criador ou Empresa, tanto faz.

### 3.2 Página do Facebook — dispensada
Este projeto usa a **API do Instagram com login do Instagram**
(`graph.instagram.com`), que não exige Página do Facebook nem token de
Página. A conta profissional do passo 3.1 é suficiente.

### 3.3 Criar o app
`developers.facebook.com/apps` → **Criar app** → tipo **Empresa**.
Adicione o caso de uso **"Gerenciar mensagens e conteúdo no Instagram"**.

---

## Parte 4 — Credenciais (15 min)

| Variável | Onde achar |
|---|---|
| `IG_APP_SECRET` | Configurações → Básico → Chave secreta do app |
| `IG_VERIFY_TOKEN` | Você inventa. Só precisa bater com a Parte 5 |
| `IG_ACCESS_TOKEN` | Painel do app → API do Instagram → Gerar tokens de acesso |

O token gerado no painel é de curta duração (~1h). Troque por um de longa
duração (~60 dias):

```bash
curl -G "https://graph.instagram.com/access_token" \
  -d "grant_type=ig_exchange_token" \
  -d "client_secret=SEU_APP_SECRET" \
  -d "access_token=TOKEN_CURTO"
```

Coloque os valores na Vercel (**Settings → Environment Variables**) e
**redeploy** — variáveis novas só valem no build seguinte.

> O token de longa duração expira em ~60 dias. O app o guarda no banco e
> renova sozinho no tick do cron/worker quando faltam menos de 10 dias; se a
> renovação falhar, a página **Configurações** avisa. Só nesse caso gere um
> token novo e atualize `IG_ACCESS_TOKEN`.

---

## Parte 5 — Webhook (10 min)

Em **Webhooks → Instagram → Assinar este objeto**:

- **URL de callback**: `https://SEU-APP.vercel.app/api/webhook/instagram`
- **Token de verificação**: o mesmo `IG_VERIFY_TOKEN`

Clique em **Verificar e salvar**. A Meta faz um GET na hora — se as
variáveis não estiverem no ambiente do deploy atual, falha aqui.

Depois **assine os campos**: `messages`, `messaging_postbacks`, `comments`.

Teste real: mande "oi" no DM da sua conta pelo Instagram. O fluxo
"Boas-vindas" deve responder. Se não responder, veja os logs em
**Vercel → Deployments → Functions**.

---

## Parte 6 — App Review

Em modo desenvolvimento **já funciona** com contas listadas em **Funções do
app**. Adicione a sua e teste à vontade — não precisa esperar o review para
usar você mesmo.

Para atender qualquer pessoa, solicite:

- `instagram_business_basic`
- `instagram_business_manage_messages`
- `instagram_business_manage_comments` (necessária para comment-to-DM)

A Meta exige um **vídeo de tela** mostrando o ciclo completo: alguém
comenta no post → recebe a DM → responde → o fluxo continua. Grave com o
sistema já em produção, em modo desenvolvimento.

Descreva o caso de uso como automação de atendimento da própria conta —
que é o que de fato é. Recusa e reenvio são comuns; não é sinal de
problema no código.

---

## Checklist

- [ ] Neon criado, `migrate deploy` rodado
- [ ] Deploy na Vercel com todas as env vars
- [ ] Painel abre e pede senha
- [ ] Conta IG profissional adicionada como Testador do Instagram
- [ ] Caso de uso do Instagram configurado
- [ ] Token de longa duração gerado (data anotada)
- [ ] Webhook verificado e campos assinados
- [ ] "oi" no DM dispara o fluxo
- [ ] Vídeo gravado e review enviado

---

## Custos

| Item | Custo |
|---|---|
| Vercel Hobby | grátis (uso pessoal) |
| Neon free tier | grátis (0.5 GB) |
| Meta APIs | grátis |

Vercel Hobby limita funções a 60s — por isso o cron processa em fatias e
retoma na chamada seguinte (o próximo webhook, ou o cron do dia seguinte).
Para listas grandes de broadcast, prefira o worker (`bun run worker`) numa
máquina sua; na Vercel o envio se espalha ao longo das mensagens recebidas.

## Se algo falhar

**Webhook não verifica** — `IG_VERIFY_TOKEN` diferente entre a Vercel e o
painel da Meta, ou faltou redeploy depois de adicionar a variável.

**Mensagens não saem** — token expirado (60 dias), ou o contato está fora
da janela de 24h. O painel mostra quem está alcançável.

**`P1001` no migrate** — você usou a string pooled em `DIRECT_URL`. A
migração precisa da conexão direta.

**Painel responde 503** — `ADMIN_PASSWORD` não está definida no ambiente
daquele deploy.
