# Build context: repository root  (docker build -f apps/api/Dockerfile .)
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable && apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @fisher/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @fisher/api build

FROM node:22-slim
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* \
  && useradd -r -u 1001 app && mkdir -p /data/storage && chown app /data/storage
COPY --from=build --chown=app /app /app
USER app
ENV NODE_ENV=production PORT=3000 STORAGE_LOCAL_DIR=/data/storage
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# apply pending migrations (non-destructive) then start
CMD ["sh", "-c", "cd apps/api && npx prisma migrate deploy && node dist/server.js"]
