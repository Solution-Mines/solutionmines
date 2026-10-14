# syntax=docker/dockerfile:1

# ============================================================================
# SolutionMines — production image
#
# Built in CI, never on the server. A `next build` on a small VPS is slow at
# best and an OOM at worst, while the live site is sharing the box.
#
# Debian slim, NOT Alpine: sharp (which the image optimiser needs the moment
# a real image is added) links against libvips/glibc, and musl is a
# well-documented source of image-optimisation failures that only show up in
# production.
# ============================================================================

ARG NODE_VERSION=22.22.0

# --- deps -------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
# --frozen-lockfile makes a drifted lockfile fail the build instead of
# silently resolving different versions than were tested.
RUN --mount=type=cache,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store && \
    pnpm install --frozen-lockfile

# --- build ------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
RUN corepack enable

# These are read by `next build`, not by the server, because the routes using
# them are statically generated. That is why staging and production need
# SEPARATE IMAGES rather than the same image with different env — the single
# most common Next.js self-hosting mistake.
ARG SITE_ENV=production
ARG NEXT_PUBLIC_SITE_URL
ENV SITE_ENV=$SITE_ENV
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `next build` traces dependencies into .next/standalone but deliberately does
# not copy static assets. Without the package step every page serves unstyled.
RUN pnpm build && pnpm package

# --- runtime ----------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Bind to all interfaces INSIDE the container; the published port is bound to
# 127.0.0.1 on the host, so Node is never reachable from the internet directly.
ENV HOSTNAME=0.0.0.0

# curl is here only for the container healthcheck. It is the one addition to
# the slim base, and it is worth ~4 MB to have the orchestrator know whether
# the app is actually answering rather than merely running.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

# node:*-slim already ships an unprivileged `node` user (uid 1000).
USER node

COPY --from=build --chown=node:node /app/.next/standalone ./

# Stamped at build time so /api/health can prove which image is answering —
# this is what catches a deploy that "succeeded" but left the old container up.
ARG GIT_COMMIT_SHA=unknown
ENV GIT_COMMIT_SHA=$GIT_COMMIT_SHA

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
