# Любой контейнерный хостинг: fly.io, Railway, Render (Docker), VPS.
# Сборка не нужна — клиент отдаётся как статика, поэтому образ маленький.
FROM node:22-alpine

WORKDIR /app

# Зависимости отдельным слоем: пересборка при правке кода не тянет их заново.
COPY package*.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

USER node

CMD ["node", "server/server.js"]
