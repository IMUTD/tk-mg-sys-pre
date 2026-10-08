FROM oven/bun:1.3.13 AS dependencies

WORKDIR /workspace

COPY package.json bun.lock pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json biome.jsonc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/device-adapter/package.json packages/device-adapter/package.json
COPY packages/task-execution/package.json packages/task-execution/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/storage-adapter/package.json packages/storage-adapter/package.json

RUN bun install --frozen-lockfile

FROM ghcr.io/sagernet/sing-box:v1.12.12@sha256:2b3c5449f5cae0268a28853193f40ed8a7d8943c241bc47d1f3218cc9be914c7 AS proxy-core

FROM dependencies AS api

COPY --from=proxy-core /usr/local/bin/sing-box /usr/local/bin/sing-box

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "apps/api/src/main.ts"]

FROM dependencies AS worker

COPY . .

ENV NODE_ENV=production

CMD ["bun", "apps/worker/src/main.ts"]

FROM dependencies AS web-build

COPY . .

RUN bun run --cwd apps/web build

FROM nginx:1.27-alpine AS web

COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /workspace/apps/web/dist /usr/share/nginx/html

EXPOSE 80
