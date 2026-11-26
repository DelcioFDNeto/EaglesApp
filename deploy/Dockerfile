# API do Eagles (adapter-node). O frontend estático vai para o Firebase à parte.
#
# Node 22: as migrações rodam o .ts direto com --experimental-strip-types,
# que não existe no Node 20.

FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# A API e o script de primeiro acesso (deploy/primeiro-master.ts), empacotado
# num .mjs só: as dependências de produção ficam em node_modules.
RUN BUILD_TARGET=api npx vite build \
	&& npx esbuild deploy/primeiro-master.ts --bundle --platform=node --format=esm \
		--target=node22 --packages=external --outfile=tools/primeiro-master.mjs \
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
COPY --from=builder --chown=eagles:eagles /app/tools ./tools
# O script de migração resolve a pasta `migrations` relativa a si mesmo.
COPY --from=builder --chown=eagles:eagles /app/src/lib/server/db/migrate.ts ./db/migrate.ts
COPY --from=builder --chown=eagles:eagles /app/src/lib/server/db/migrations ./db/migrations
COPY --chown=eagles:eagles deploy/entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh

USER eagles
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "build"]
