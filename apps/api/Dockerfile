# syntax=docker/dockerfile:1
#
# Rotaract DIS API.
#
# Built from the REPOSITORY ROOT, not from apps/api:
#   docker build -f apps/api/Dockerfile .
# npm workspaces resolve @dis/contracts through the root node_modules, so a build context
# of apps/api alone cannot see the package it depends on.

# Debian slim, NOT alpine. Prisma's engine is built against glibc and segfaults on
# musl with no output at all — a container that exits 139 and logs nothing, which is
# an unpleasant thing to debug on a staging box at midnight. The extra ~40MB is worth
# not having that conversation.

# ─── Stage 1: the web client ────────────────────────────────────────────────────
#
# A stage of its own, so React, Vite and Tailwind never reach the runtime image. They are
# `dependencies` of @dis/web rather than devDependencies, so `npm prune --omit=dev` in the
# API stage would not remove them — only never installing them there does.
#
# The SPA is served by the API from the same origin (M2 session 2), which is why it is in
# this image at all. `apps/web/src/lib/api.ts` addresses the API as a relative `/api/v1`,
# so the bundle carries no environment-specific URL and the same artefact works in staging
# and in production.
FROM node:20-slim AS web
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci --include-workspace-root --workspace @dis/web --workspace @dis/contracts \
      --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/web apps/web

RUN npm run build:contracts \
 && npm run build --workspace @dis/web

# ─── Stage 2: API dependencies and build ────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app

# `argon2` has no prebuilt binary for this platform and compiles from source, which needs
# a toolchain the slim image does not carry. It lives in THIS stage only — the runtime
# image copies the compiled module and never sees a compiler.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Manifests first, so `npm ci` is cached and only re-runs when a dependency changes —
# not on every source edit.
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# The API's postinstall runs `prisma generate`, which needs the schema present.
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/

# Scripts ENABLED, deliberately. `argon2` is a native module whose binding is selected by
# its install script; with --ignore-scripts it is never produced and the process segfaults
# on import — exit 139, no stack, no message. The API's own postinstall (`prisma generate`)
# is why the schema and prisma.config.ts are copied above.
#
# The workspace flags scope which workspaces are LINKED and which lifecycle scripts run.
# They do NOT scope what `npm ci` installs: it resolves the whole lockfile, so @dis/web's
# runtime dependencies land in the root node_modules whatever is named here. `npm prune
# --omit=dev` below removes Vite, Tailwind and esbuild, which are devDependencies; React,
# react-router and TanStack Query are not, and survive at about 15MB of a 393MB tree.
# Measured, not assumed, because the comment that used to be here claimed otherwise.
# Not worth contorting the build for — the Prisma CLI and its engines are ~215MB of it.
RUN npm ci --include-workspace-root --workspace @dis/api --workspace @dis/contracts

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api

# Regenerated after the sources land: Prisma 7 emits the client as TypeScript into
# src/generated/prisma, which is gitignored and therefore absent from the build context.
RUN npm run db:generate \
 && npm run build:contracts \
 && npm run build --workspace @dis/api

# `prune`, not a second `npm ci --omit=dev`. Reinstalling would have to choose between
# running scripts — and failing, because `prisma generate` needs a CLI that --omit=dev
# just removed — and skipping them, which is what breaks argon2. Pruning drops the dev
# dependencies from a tree whose native modules are already built.
RUN npm prune --omit=dev

# ─── Stage 3: runtime ───────────────────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Fly and Railway both route to whatever the process binds; 8080 is their convention.
ENV PORT=8080

# `node` exists in the base image with uid 1000. Running as root in a container that
# terminates TLS from the open internet buys nothing and costs a privilege boundary.
USER node

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
# Migrations travel with the image so `migrate deploy` can run as a release step against
# the same version of the schema the code was built for.
#
# This is why `prisma` is a runtime dependency and why the image is ~800MB, of which the
# CLI and its engines are ~215MB. The alternative — migrating from CI — does not work on
# Fly, whose managed Postgres is reachable only over the private network, so a CI runner
# would need a proxy. A large image on a deploy nobody watches beats a migration path
# that depends on a tunnel staying up.
COPY --from=build --chown=node:node /app/apps/api/prisma ./apps/api/prisma

# The SPA. `platform/web-client.ts` resolves `apps/web/dist` relative to itself, which is
# the same two levels up in `dist/` as in `src/`, so this path is the one it looks for.
# Static files only — none of the toolchain that produced them.
COPY --from=web --chown=node:node /app/apps/web/dist ./apps/web/dist

EXPOSE 8080

# The one route that needs no session and returns no data.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/v1/admin/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]
