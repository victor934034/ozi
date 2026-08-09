# Imagem do "cerebro" do Ozi (Node.js) pra rodar numa VPS via EasyPanel.
#
# UM SO processo/porta: src/app.js sobe HTTP (paginas, API REST) e
# WebSocket (a conversa em si) no mesmo servidor, escutando a porta
# definida por PORT (padrao 8787). Isso existe pra funcionar direto em
# qualquer PaaS/EasyPanel que so mapeia 1 porta por app - nao precisa criar
# dois "apps"/dominios nem sobrescrever Start Command.

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

EXPOSE 8787

CMD ["node", "src/app.js"]
