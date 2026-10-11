FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile=false

RUN pnpm --filter @trading-bot/worker... run build

ENV NODE_ENV=production

CMD ["pnpm", "--dir", "apps/worker", "start"]
