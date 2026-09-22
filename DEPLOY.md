# Publicar na sua conta — Vercel + Neon

Este guia assume que você já rodou o app local e viu uma DM chegar pelo túnel,
como descrito no [README](README.md). Se ainda não, faça isso antes: depurar
credencial da Meta e deploy ao mesmo tempo dobra o trabalho.

Tempo: cerca de uma hora. Custo: zero nos planos grátis.

Por que Vercel e Neon: o app é Next.js com Postgres, e essa dupla é a que exige
menos configuração. Qualquer host que rode Node 20+ e qualquer Postgres
funcionam — o que muda está na seção "fora da Vercel", no fim.

---

## Antes de qualquer coisa: duas decisões

Elas mudam o comportamento do sistema e é melhor decidir agora do que descobrir
depois.

### O cron roda uma vez por dia

O plano Hobby da Vercel permite **um disparo de cron por dia**. O
`vercel.json` já está assim (`0 9 * * *`).

Isso não quebra a automação. O trabalho de fundo tem três caminhos, e o
principal é o webhook: **toda mensagem recebida drena a fila** — retoma delays
vencidos, empurra o disparo em andamento, consolida as estatísticas. Uma conta
que recebe DM se mantém sozinha.

O cron é o **piso para uma conta parada**. E é aí que dói: se ninguém mandar
mensagem, um nó de delay de 30 minutos pode só retomar no dia seguinte.
**Numa conta sem movimento, um delay pode atrasar até 24h.**

Três saídas, e a escolha é sua:

1. **Aceitar.** Se os seus fluxos respondem na hora e os delays são de horas,
   não de minutos, isso nunca vai te incomodar.
2. **Plano pago da Vercel.** Cron de minuto em minuto; basta trocar o
   `schedule` no `vercel.json` para `* * * * *`. O código não muda.
3. **Worker próprio.** `npm run worker` numa VPS ou no docker-compose: laço de
   5 segundos, delay confiável, e sem orçamento de tempo no drain. É o caminho
   certo também se você dispara para listas grandes.

### `TRUST_PROXY` — a pegadinha

**Na Vercel, não defina esta variável.** A Vercel marca `VERCEL=1` e manda
`x-vercel-forwarded-for` sozinha, e o app já confia nisso.

A armadilha aparece se você trocar de host. O rate limit do login (5 tentativas
por IP a cada 15 min) precisa do IP de quem chamou, e esse IP vem de
`x-forwarded-for` — um header que o cliente pode semear e cada proxy só anexa.
A única entrada confiável é a última, escrita pelo **seu** proxy, e ela só
existe se houver um proxy.

Então o app só lê esse header quando o deploy declara que há um: `TRUST_PROXY=1`
ou `VERCEL`. Sem isso, ignora o header e joga todas as tentativas num balde só.

As duas metades da pegadinha:

- **Tem proxy (nginx, Caddy, Traefik, túnel) e esqueceu `TRUST_PROXY=1`?** O
  limite vira global: cinco senhas erradas de qualquer origem trancam o login
  para todo mundo por 15 minutos. Seguro, mas áspero.
- **Definiu `TRUST_PROXY=1` sem ter proxy?** Pior. O atacante passa a controlar
  o header, troca o valor a cada tentativa, ganha um balde novo por tentativa e
  faz força bruta na sua senha sem nunca bater no limite.

Regra prática: defina `1` **se e somente se** houver um proxy seu na frente, e
que sobrescreva o header do cliente.

---

## Parte 1 — Banco no Neon

1. Conta em [neon.tech](https://neon.tech) → **New Project** → nome `manychat`,
   região mais perto de você (latência ao banco aparece em toda página).

2. Em **Connection Details**, copie as **duas** strings:

   - a que tem `-pooler` no host → `DATABASE_URL`
   - a direta, sem `-pooler` → `DIRECT_URL`

   As duas são necessárias. Cada função serverless abre uma conexão por
   invocação e esgotaria o limite direto do Postgres em minutos; já o Prisma
   Migrate não atravessa um pooler de transação. Por isso o schema declara as
   duas.

3. Crie as tabelas a partir da sua máquina, apontando para o Neon:

   ```bash
   cd app
   # no .env, troque DATABASE_URL e DIRECT_URL pelas strings do Neon
   npx prisma migrate deploy
   npm run db:seed        # opcional: o fluxo e os contatos de exemplo
   ```

   `migrate deploy` aplica as migrações existentes e não gera nenhuma nova —
   é o comando certo para produção. `migrate dev` não.

---

## Parte 2 — Deploy na Vercel

1. Suba o código para o GitHub:

   ```bash
   cd app
   gh repo create manychat-clone --private --source=. --push
   ```

   Confira que o `.env` **não** subiu (`git status` limpo, `.gitignore` já
   cobre). Se subiu, rotacione tudo antes de seguir.

2. Em `vercel.com` → **Add New → Project** → importe o repositório. Framework
   Next.js é detectado sozinho. **Não faça deploy ainda.**

3. Em **Environment Variables**, adicione tudo **antes** do primeiro build. A
   lista completa, com explicação de cada uma, está no `.env.example`; o
   mínimo para subir:

   | Variável | Valor |
   | --- | --- |
   | `DATABASE_URL` | string **pooled** do Neon |
   | `DIRECT_URL` | string **direta** do Neon |
   | `ADMIN_PASSWORD` | `openssl rand -base64 24` |
   | `AUTH_SECRET` | `openssl rand -hex 32` |
   | `CRON_SECRET` | `openssl rand -hex 32` |
   | `IG_APP_SECRET` | do app na Meta |
   | `IG_VERIFY_TOKEN` | a string que você inventou |
   | `IG_ACCESS_TOKEN` | o token de 60 dias |
   | `IG_USERNAME` | seu @ sem arroba, para os links de ref e QR codes |
   | `ACCOUNT_TIMEZONE` | `America/Sao_Paulo` |

   Se a Vercel oferecer escolher os ambientes, marque **Production** para
   todas. As três da Meta podem entrar vazias e ser preenchidas depois; o
   painel sobe sem elas, o webhook é que fica trancado em 503.

   **Não** defina `TRUST_PROXY` aqui. Veja acima.

4. **Deploy.** No fim você recebe `https://manychat-clone-xxx.vercel.app`.

5. Abra a URL: tem que pedir a senha. Entre e confira o painel. O cron já
   está ativo pelo `vercel.json`.

> **Variável nova só vale no build seguinte.** Toda vez que você adicionar ou
> mudar uma variável na Vercel, faça **Redeploy**. Metade dos "não funciona
> depois que eu configurei" é isso.

---

## Parte 3 — Apontar a Meta para a URL de produção

Você já montou o app na Meta seguindo a etapa 3 do README. Falta trocar o
túnel pela URL real.

1. No painel da Meta, na seção **Webhooks** do caso de uso do Instagram, troque
   a **Callback URL** para:

   ```
   https://SEU-APP.vercel.app/api/webhook/instagram
   ```

   O **Verify token** continua o mesmo. Salve — a Meta refaz o handshake GET na
   hora. Se falhar, quase sempre é `IG_VERIFY_TOKEN` diferente entre a Vercel e
   a Meta, ou um redeploy que não aconteceu.

2. **Refaça a inscrição do app na conta**, apontando para o token de produção:

   ```bash
   curl -X POST "https://graph.instagram.com/v26.0/me/subscribed_apps" \
     -d "subscribed_fields=messages,messaging_postbacks,comments,messaging_seen,messaging_referral" \
     -d "access_token=$IG_ACCESS_TOKEN"
   ```

3. Mande "oi" no DM da sua conta. O fluxo tem que responder. Se não responder,
   os logs estão em **Vercel → Deployments → Functions**.

---

## Parte 4 — Conferir que está de pé

```bash
# saúde: banco, validade do token, última chamada à Meta, erros em 24h
curl https://SEU-APP.vercel.app/api/health

# forçar um tick (o que o cron faria)
curl -H "Authorization: Bearer $CRON_SECRET" https://SEU-APP.vercel.app/api/cron/tick
```

O `/api/health` é público de propósito, para monitor de uptime: devolve
status, nunca valores. Responde 503 quando o banco não responde — aponte um
UptimeRobot da vida para ele.

O `CRON_SECRET` vai no **header**, nunca em query string: segredo em URL fica
gravado no log de acesso da Vercel, em cada proxy do caminho e no seu histórico
de shell, e quem ler o log passa a poder mandar mensagem no seu lugar.

### Checklist

- [ ] Neon criado, `migrate deploy` rodado
- [ ] Deploy na Vercel com todas as variáveis, `TRUST_PROXY` ausente
- [ ] Painel abre e pede senha
- [ ] Webhook verificado apontando para a URL da Vercel
- [ ] `POST /me/subscribed_apps` refeito com o token de produção
- [ ] "oi" no DM dispara o fluxo
- [ ] `/api/health` responde `ok`
- [ ] Data do token anotada (vale 60 dias; o app renova sozinho, mas confira em
      `/configuracoes` na primeira semana)

---

## Custos e limites

| Item | Custo | Limite que te afeta |
| --- | --- | --- |
| Vercel Hobby | grátis | função até 60s; cron 1×/dia |
| Neon free | grátis | 0,5 GB; o banco hiberna sem uso e a primeira query demora |
| APIs da Meta | grátis | rate limit por conta, não por dinheiro |

O teto de 60s é o motivo de o drain trabalhar com **orçamento de tempo**: o
webhook drena por até 9s (contra `maxDuration = 15`) e o cron por até 45s
(contra 60), devolvendo o lock ao parar. O que sobrou continua na chamada
seguinte, e ninguém recebe duas vezes. Para listas grandes, o worker próprio é
melhor — na Vercel o envio se espalha ao longo das mensagens que chegam.

---

## Fora da Vercel

O `docker-compose.yml` sobe três serviços: Postgres, o app e o worker. Basta
preencher as variáveis no ambiente e `docker compose up -d`.

Duas diferenças em relação à Vercel, e as duas importam:

- **Existe worker de verdade** (`npm run worker`, laço de 5s, ajustável por
  `WORKER_TICK_MS`). Delays curtos retomam na hora e o drain roda sem
  orçamento. O `vercel.json` passa a ser irrelevante.
- **`TRUST_PROXY` volta à mesa.** O Dockerfile serve `npm run start` direto na
  porta 3000. Se você puser nginx ou Caddy na frente — e vai, nem que seja pelo
  TLS — defina `TRUST_PROXY=1`. Se expuser a 3000 direto na internet, não
  defina, e reveja essa escolha.

> O `docker-compose.yml` do repositório não repassa `AUTH_SECRET`,
> `TRUST_PROXY`, `LOG_LEVEL`, `SENDER_ACTIONS` nem `HUMAN_AGENT` para os
> containers. Acrescente as que você usar no bloco `environment` antes de subir.

---

## Se algo falhar

**Painel responde 503** — nem `ADMIN_PASSWORD` nem `AUTH_SECRET` no ambiente
daquele deploy. Adicione e **redeploy**.

**Webhook não verifica** — `IG_VERIFY_TOKEN` diferente entre Vercel e Meta, ou
faltou redeploy depois de adicionar a variável. Teste direto:
`curl "https://SEU-APP.vercel.app/api/webhook/instagram?hub.mode=subscribe&hub.verify_token=SEU_TOKEN&hub.challenge=teste"` — tem que devolver `teste`.

**Webhook verifica mas nada chega** — o `POST /me/subscribed_apps` da Parte 3.
É o erro mais comum de todos.

**Webhook responde 401** — assinatura inválida: `IG_APP_SECRET` é de outro app
ou foi copiado com espaço no fim.

**Mensagens não saem** — token expirado, ou o contato está fora da janela de
24h. `/configuracoes` mostra o estado do token e o painel mostra quem está
alcançável.

**`P1001` no migrate** — você usou a string pooled em `DIRECT_URL`. Migração
precisa da conexão direta.

**Disparo trava em "enviando"** — na Vercel ele avança a cada mensagem recebida
e uma vez por dia no cron. Numa conta parada, force com o curl do
`/api/cron/tick`, ou suba o worker.
