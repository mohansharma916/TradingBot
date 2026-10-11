FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile=false

COPY infrastructure/scripts/copy-api-assets.cjs ./infrastructure/scripts/copy-api-assets.cjs

RUN pnpm --filter @trading-bot/api... run build

ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["pnpm", "--dir", "apps/api", "start"]
