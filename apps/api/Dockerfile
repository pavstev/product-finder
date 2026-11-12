# API image. Build context is the repo root.
# build: Nx builds dist/apps/api. deps: a prod install from the package.json and lock file that
# Nx generates there. runtime: only the bundle and those dependencies, no sources and no pnpm.
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
RUN pnpm nx build api --skip-nx-cache

FROM node:24-alpine AS deps
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
# The generated lock file pins every version, so the install is the same as in the workspace.
# No install scripts: they only fetch the Prisma schema engine, which the API never runs.
COPY --from=build /app/dist/apps/api/package.json /app/dist/apps/api/pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# root owns the files, so the node user can run them but not change them. No source map: it holds the sources.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist/apps/api/package.json /app/dist/apps/api/main.js /app/dist/apps/api/otel.js ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://localhost:3000/api/health/ready || exit 1
# otel.js loads OpenTelemetry before main.js loads Express, pg and Nest. It sends traces and metrics
# only when OTEL_EXPORTER_OTLP_ENDPOINT is set. Otherwise it does nothing.
CMD ["node", "--require", "./otel.js", "main.js"]
