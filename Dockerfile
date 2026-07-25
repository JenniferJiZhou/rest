FROM node:20.19.5-bookworm-slim AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable \
    && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app/server
COPY server/package.json server/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY server/tsconfig.json server/tsconfig.build.json ./
COPY server/src ./src
RUN pnpm build \
    && pnpm prune --prod

FROM node:20.19.5-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0

WORKDIR /app
COPY --from=build --chown=node:node /app/server/dist ./server/dist
COPY --from=build --chown=node:node /app/server/node_modules ./server/node_modules
COPY --chown=node:node content/rest-quests.json ./content/rest-quests.json
COPY --chown=node:node contracts/fixtures/mail-items-demo.json ./contracts/fixtures/mail-items-demo.json

WORKDIR /app/server
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "-e", "const port = process.env.PORT ?? '3000'; fetch(`http://127.0.0.1:${port}/v1/health`).then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]
CMD ["node", "dist/bootstrap.js"]
