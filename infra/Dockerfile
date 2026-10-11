# Build em múltiplos estágios: a imagem final não carrega compilador,
# código-fonte nem dependências de desenvolvimento.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app

# Sem root. O uid 1000 casa com o `user:` do docker-compose e com o dono
# do volume de arquivos.
RUN addgroup -g 1000 -S eagles 2>/dev/null || true; \
	adduser -u 1000 -S eagles -G eagles 2>/dev/null || true; \
	mkdir -p /dados/arquivos && chown -R 1000:1000 /dados

COPY --from=build --chown=1000:1000 /app/build ./build
COPY --from=build --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=build --chown=1000:1000 /app/package.json ./
# As migrações viajam junto, COM quem as aplica: o serviço `migrate` do
# docker-compose roda `migrate.ts` antes de o app subir. Antes, só a pasta
# viajava — e nada na imagem sabia aplicá-la (varredura de 11/10/2026).
COPY --from=build --chown=1000:1000 /app/src/lib/server/db/migrations ./migrations
COPY --from=build --chown=1000:1000 /app/src/lib/server/db/migrate.ts ./migrate.ts

USER 1000:1000
ENV NODE_ENV=production PORT=3000
EXPOSE 3000

# Sinal correto de parada, para o Node encerrar as conexões antes de morrer.
STOPSIGNAL SIGTERM

CMD ["node", "build/index.js"]
