# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

FROM base AS deps

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/cli/package.json packages/cli/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/cf-workers/package.json packages/cf-workers/package.json
COPY packages/node-service/package.json packages/node-service/package.json

RUN pnpm install --frozen-lockfile

FROM deps AS build

COPY packages/core ./packages/core
COPY packages/node-service ./packages/node-service

RUN pnpm --filter @copilot-portal/node-service build

FROM node:22-alpine AS runtime

WORKDIR /app

ARG COMMIT_SHA=unknown
ENV COMMIT_SHA=$COMMIT_SHA
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /app/packages/node-service/dist ./dist

EXPOSE 8080

CMD ["node", "dist/server.js"]
