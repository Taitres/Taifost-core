FROM node:24 AS builder
ENV MONGOMS_DISABLE_POSTINSTALL=1
ENV REDISMS_DISABLE_POSTINSTALL=1
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable
RUN corepack prepare pnpm@11.13.0 --activate
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=marlin-core-pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=marlin-core-pnpm,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile
RUN pnpm bundle
RUN mv apps/core/out ./out
RUN cp -R apps/core/src/database/migrations ./out/migrations
# Build the admin dashboard from this workspace instead of downloading a
# prebuilt release. Vite emits apps/admin/dist/{index.html,assets,js}; the
# server expects index.html at the asset root, so copy dist/* into out/admin
# (flattening the dist/ wrapper, matching the old download layout exactly).
RUN pnpm --filter @mx-admin/admin run build
RUN mkdir -p ./out/admin && cp -R apps/admin/dist/. ./out/admin/
# Stamp the built-in admin version (mirrors the runtime updater's `version` file).
RUN node -p "require('./apps/admin/package.json').version" > ./out/admin/version

FROM node:24-alpine AS runner

# Keep the production image focused on the server runtime. Core's optional
# browser-based Open Graph fallback previously pulled Chromium and the full
# CJK font set into every image; the normal HTTP enrichment path and MARLIN's
# guarded URL importer do not require it.
RUN apk add --no-cache zip unzip postgresql-client bash rsync jq curl

WORKDIR /app
COPY --from=builder /app/out .

RUN npm i sharp -g
RUN npm i sharp

COPY --chmod=755 docker-entrypoint.sh .

ENV TZ=Asia/Shanghai
ENV MIGRATIONS_DIR=/app/migrations

EXPOSE 2333

ENTRYPOINT [ "./docker-entrypoint.sh" ]
