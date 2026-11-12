# English Words Bot

Telegram-бот + Mini App для изучения английских слов.

## Запуск локально

Нужны: Node 20+, pnpm (`npm i -g pnpm`), Docker Desktop.

```bash
pnpm install
cp .env.example .env      # заполни BOT_TOKEN и ALLOWED_USERS
pnpm db:up                # Postgres в Docker
pnpm dev                  # бот в режиме watch, миграции применяются сами
```

Открой бота в Telegram → `/start`.

> Бот на long polling: одновременно может работать только один экземпляр с этим токеном.
> Перед запуском на сервере останови локальный.

## Структура

```
apps/server/        бот (grammY) + позже API (Fastify)
  src/config.ts     проверка .env
  src/db/           схема Drizzle и подключение
  src/bot/          хендлеры и клавиатуры
  drizzle/          SQL-миграции (генерируются: pnpm db:generate)
packages/shared/    общие типы для сервера и Mini App
```

## Изменение схемы БД

1. Правишь `apps/server/src/db/schema.ts`
2. `pnpm db:generate` — создаёт новую миграцию в `apps/server/drizzle/`
3. При следующем запуске она применится автоматически
