# Imagem do "cerebro" do Ozi (Node.js) pra rodar numa VPS via EasyPanel.
#
# O projeto tem DOIS processos separados que escutam portas diferentes:
#   - src/server.js    (WebSocket - a conversa em si)      -> porta 8787
#   - src/webServer.js (HTTP - painel admin, paginas, API)  -> porta 8788
#
# No EasyPanel, crie DOIS "apps" a partir desta mesma imagem/Dockerfile,
# cada um com um Start Command diferente (ver README-DEPLOY.md):
#   app 1: node src/server.js     -> dominio tipo ws.seudominio.com
#   app 2: node src/webServer.js  -> dominio tipo app.seudominio.com
# Os dois PRECISAM compartilhar o mesmo volume de dados (ver docker-compose.yml
# de referencia) - e o mesmo arquivo data/jarvis.db (usuarios, conversas, etc).

FROM node:22-bookworm-slim AS builder

WORKDIR /app

# python3/make/g++: fallback pra compilar o better-sqlite3 na unha se nao
# existir um binario pre-compilado pra essa combinacao exata de plataforma -
# normalmente nao e nem usado (o pacote baixa um .node pronto), mas evita
# quebrar o build silenciosamente se isso mudar no futuro.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

# --- Imagem final, mais enxuta (sem python/make/g++) ---
FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY package.json ./

# Onde ficam o SQLite e o cache de embeddings - precisa ser um volume
# persistente (senao voce perde usuarios/memoria a cada deploy novo).
VOLUME ["/app/data"]

EXPOSE 8787 8788

# Padrao: sobe o "cerebro" (WebSocket). No segundo app do EasyPanel,
# sobrescreva o Start Command pra "node src/webServer.js".
CMD ["node", "src/server.js"]
