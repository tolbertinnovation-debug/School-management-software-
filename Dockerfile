FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server ./server
COPY public ./public
COPY scripts ./scripts

# data volume: SQLite db, uploads, backups
RUN mkdir -p /app/data
VOLUME /app/data

EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server/index.js"]
