#!/usr/bin/env bash
# Deploy do ManyChat Clone na Vercel. Vive em app/ (o repositório); a raiz
# tem um deploy.sh de duas linhas que só chama este.
#
# Pré-requisitos (só estes dois exigem você):
#   1. vercel login          — OAuth no navegador
#   2. as duas strings do Neon, em app/.env
#
# O resto é automático: linka o projeto, escreve as env vars e faz o deploy
# de produção. Os segredos vêm de ../SEGREDOS.txt (fora do repositório).

set -euo pipefail
cd "$(dirname "$0")"

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RED=$'\033[31m'; NC=$'\033[0m'
step() { echo; echo "${BOLD}▶ $1${NC}"; }
ok()   { echo "${GREEN}  ✓ $1${NC}"; }
die()  { echo "${RED}  ✗ $1${NC}"; exit 1; }

# --- 0. checagens -----------------------------------------------------
step "Verificando pré-requisitos"
command -v vercel >/dev/null || die "vercel CLI não encontrada (npm i -g vercel)"
vercel whoami >/dev/null 2>&1 || die "não logado. Rode primeiro:  vercel login"
ok "vercel CLI, logado como $(vercel whoami 2>/dev/null)"

[ -f ../SEGREDOS.txt ] || die "SEGREDOS.txt não encontrado na raiz do projeto"
ADMIN_PASSWORD=$(grep '^ADMIN_PASSWORD=' ../SEGREDOS.txt | cut -d= -f2-)
CRON_SECRET=$(grep '^CRON_SECRET=' ../SEGREDOS.txt | cut -d= -f2-)
IG_VERIFY_TOKEN=$(grep '^IG_VERIFY_TOKEN=' ../SEGREDOS.txt | cut -d= -f2-)
ok "segredos carregados"

# --- 1. conexões do Neon ---------------------------------------------
step "Carregando conexões do Neon"
[ -f .env ] || die ".env não encontrado em app/"
set -a; . ./.env; set +a
[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL vazia em app/.env"
[ -n "${DIRECT_URL:-}" ]   || die "DIRECT_URL vazia em app/.env"
ok "conexões carregadas (migração já aplicada)"

# --- 3. linkar projeto ------------------------------------------------
step "Linkando o projeto na Vercel"
vercel link --yes >/dev/null 2>&1 || vercel link
ok "projeto linkado"

# --- 4. variáveis de ambiente ----------------------------------------
step "Enviando variáveis de ambiente"
set_env() {
  # remove antes de adicionar: 'vercel env add' não sobrescreve
  vercel env rm "$1" production --yes >/dev/null 2>&1 || true
  printf '%s' "$2" | vercel env add "$1" production >/dev/null 2>&1
  echo "    $1"
}
set_env DATABASE_URL       "$DATABASE_URL"
set_env DIRECT_URL         "$DIRECT_URL"
set_env ADMIN_PASSWORD     "$ADMIN_PASSWORD"
set_env CRON_SECRET        "$CRON_SECRET"
set_env IG_VERIFY_TOKEN    "$IG_VERIFY_TOKEN"
set_env GRAPH_API_VERSION  "v26.0"
set_env BROADCAST_RATE     "5"
set_env ACCOUNT_TIMEZONE   "${ACCOUNT_TIMEZONE:-America/Sao_Paulo}"
# As da Meta ficam de fora até você tê-las: a Vercel rejeita valor vazio,
# e o código já trata a ausência (o painel sobe, só não envia mensagem).
ok "8 variáveis configuradas"

# --- 5. deploy --------------------------------------------------------
step "Deploy de produção"
URL=$(vercel deploy --prod --yes 2>&1 | tail -1)
ok "no ar: $URL"

# --- 6. verificação ---------------------------------------------------
step "Verificando"
sleep 5
PANEL=$(curl -s -o /dev/null -w "%{http_code}" "$URL/")
HOOK=$(curl -s -o /dev/null -w "%{http_code}" \
  "$URL/api/webhook/instagram?hub.mode=subscribe&hub.verify_token=$IG_VERIFY_TOKEN&hub.challenge=42")
CRON=$(curl -s -o /dev/null -w "%{http_code}" "$URL/api/cron/tick")

[ "$PANEL" = "307" ] && ok "painel protegido (307 → login)" || echo "  ⚠ painel devolveu $PANEL"
[ "$HOOK" = "200" ]  && ok "webhook responde ao handshake"    || echo "  ⚠ webhook devolveu $HOOK"
[ "$CRON" = "401" ]  && ok "cron exige secret"                || echo "  ⚠ cron devolveu $CRON"

cat <<EOF

${BOLD}Pronto.${NC}

  Painel:  $URL
  Senha:   definida (ADMIN_PASSWORD em SEGREDOS.txt)

${BOLD}Próximo passo — a Meta (DEPLOY.md, partes 3 a 5):${NC}

  URL de callback:      $URL/api/webhook/instagram
  Token de verificação: $IG_VERIFY_TOKEN

  Depois de gerar IG_APP_SECRET e IG_ACCESS_TOKEN:

    vercel env rm IG_APP_SECRET production --yes
    printf '%s' 'SEU_SECRET' | vercel env add IG_APP_SECRET production
    vercel env rm IG_ACCESS_TOKEN production --yes
    printf '%s' 'SEU_TOKEN' | vercel env add IG_ACCESS_TOKEN production
    vercel deploy --prod --yes

EOF
