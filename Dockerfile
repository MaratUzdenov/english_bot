FROM node:22-alpine

WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Сначала только манифесты — чтобы зависимости кэшировались между сборками
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @english-bot/server...

COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @english-bot/shared build && pnpm --filter @english-bot/server build

ENV NODE_ENV=production
CMD ["node", "apps/server/dist/index.js"]
