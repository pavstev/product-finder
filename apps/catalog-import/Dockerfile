# catalog-import image: the migrate, import and seed CLI. Build context is the repo root.
# The nightly job runs it as it is (`import`). Compose runs `migrate` and `seed` with it.
# build: Nx builds dist/apps/catalog-import. deps: a prod install from the package.json and lock file
# that Nx generates there. runtime: the bundle, those dependencies, the Prisma config and the default export.
FROM node:24-alpine AS build
# corepack runs the pnpm version in package.json (packageManager), so that version lives in one place.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# Dependencies first, so source changes do not reinstall them. This part is the same in every
# Dockerfile, so BuildKit can reuse the layer.
# --ignore-scripts: the root postinstall (prisma-generate, generate) needs the sources, so it runs
# in the build below through the Nx task dependencies. The native tools (esbuild, swc) ship their
# binaries as optional packages, so they work without their install scripts.
COPY package.json pnpm-lock.yaml nx.json tsconfig.base.json ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# The rest of the workspace, minus .dockerignore (no specs, test folders, docs or env files).
COPY . .
RUN pnpm nx build catalog-import --skip-nx-cache

FROM node:24-alpine AS deps
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
# The generated lock file pins every version, so the install is the same as in the workspace.
# It holds the prisma CLI (7.10.1, as in the root package.json) for `migrate`. Its install
# scripts fetch the schema engine, so this install keeps them (pnpm 9 runs them by default).
COPY --from=build /app/dist/apps/catalog-import/package.json /app/dist/apps/catalog-import/pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# root owns the files, so the node user can run them but not change them. No source map: it holds the sources.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist/apps/catalog-import/package.json /app/dist/apps/catalog-import/main.js /app/dist/apps/catalog-import/otel.js ./
# `migrate` runs prisma migrate deploy with this config, found from the working directory.
COPY libs/server/prisma.config.ts libs/server/
COPY libs/server/prisma libs/server/prisma
# The default PIM export (data/products.csv from /app). --file or CATALOG_FILE picks another one.
COPY data/ data/
USER node
# otel.js loads OpenTelemetry before main.js loads pg and Prisma. It sends traces and metrics only
# when OTEL_EXPORTER_OTLP_ENDPOINT is set. Otherwise it does nothing. The sub-command is the CMD.
ENTRYPOINT ["node", "--require", "./otel.js", "main.js"]
CMD ["import"]
