# Build context: the repository root.  docker build -f deploy/Dockerfile -t zrouter .
FROM node:24-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts --fetch-retries=5 --fetch-retry-mintimeout=5000
COPY web/ ./
RUN npm run build

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --fetch-retries=5 --fetch-retry-mintimeout=5000 && npm cache clean --force
COPY server/src ./src
COPY server/migrations ./migrations
COPY server/scripts/bootstrap-admin.ts ./scripts/bootstrap-admin.ts
COPY --from=web /web/dist /app/web-dist
ENV WEB_DIST=/app/web-dist HOST=0.0.0.0 PORT=8080
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations are applied on start; they are idempotent and each runs in its own transaction.
CMD ["sh", "-c", "node src/db/migrate.ts && node src/main.ts"]
