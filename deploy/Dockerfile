# API do Eagles (adapter-node). O frontend estático vai para o Firebase à parte.
#
# Node 22: as migrações rodam o .ts direto com --experimental-strip-types,
# que não existe no Node 20.

FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN BUILD_TARGET=api npx vite build \
	&& npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Usuário sem privilégio: um RCE na API não vira root no container.
RUN addgroup -S eagles && adduser -S eagles -G eagles

COPY --from=builder --chown=eagles:eagles /app/package.json ./
COPY --from=builder --chown=eagles:eagles /app/node_modules ./node_modules
COPY --from=builder --chown=eagles:eagles /app/build-api ./build
# O script de migração resolve a pasta `migrations` relativa a si mesmo.
COPY --from=builder --chown=eagles:eagles /app/src/lib/server/db/migrate.ts ./db/migrate.ts
COPY --from=builder --chown=eagles:eagles /app/src/lib/server/db/migrations ./db/migrations
COPY --chown=eagles:eagles deploy/entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh

USER eagles
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "build"]
