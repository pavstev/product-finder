# Web image: build the Angular app, serve it with nginx. Build context is the repo root.
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
RUN pnpm nx build web --skip-nx-cache

FROM nginxinc/nginx-unprivileged:1.30.6-alpine
# The upstream alpine tags lag behind Alpine's security fixes. This line clears what Alpine has
# fixed already. Root only for the upgrade, then back to the image's unprivileged user (uid 101).
USER root
RUN apk upgrade --no-cache
USER 101
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist/apps/web/browser /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=5s --start-period=5s --timeout=3s CMD wget -q --spider http://127.0.0.1:8080/ || exit 1
