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
apps/miniapp/       Mini App (React + Vite) → GitHub Pages
packages/shared/    общие типы для сервера и Mini App
```

## Изменение схемы БД

1. Правишь `apps/server/src/db/schema.ts`
2. `pnpm db:generate` — создаёт новую миграцию в `apps/server/drizzle/`
3. При следующем запуске она применится автоматически

## Деплой на сервер

```bash
git clone https://github.com/MaratUzdenov/english_bot.git
cd english_bot
cp .env.example .env && nano .env     # BOT_TOKEN, ALLOWED_USERS, ключи ИИ, POSTGRES_PASSWORD
docker compose up -d --build
docker compose logs -f bot
```

Обновление: `git pull`, затем `docker compose up -d --build`.
Бэкап: `scripts/backup.sh` (по cron раз в день, хранит 14 дней в `backups/`).

## Mini App

- Код: `apps/miniapp`, публикуется на `https://maratuzdenov.github.io/english_bot/` через GitHub Actions (`.github/workflows/pages.yml`) при push в `main`.
- Ходит в API `https://marat-english-words.duckdns.org:8443` (переменная `VITE_API_URL`).
- Открывается кнопкой «📱 Приложение» в боте или командой `/app`. Вне Telegram показывает заглушку.
