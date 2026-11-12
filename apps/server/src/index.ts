import { bot, setupBotCommands } from './bot/index.js';
import { closeDb, runMigrations } from './db/client.js';

async function main(): Promise<void> {
  await runMigrations();
  console.log('✅ Миграции применены');

  await setupBotCommands();

  const shutdown = async (signal: string) => {
    console.log(`${signal}: останавливаюсь…`);
    await bot.stop();
    await closeDb();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  // Long polling: боту не нужен домен и порт 443.
  await bot.start({
    drop_pending_updates: true,
    onStart: (me) => console.log(`🤖 Бот @${me.username} запущен`),
  });
}

main().catch((error: unknown) => {
  console.error('Не удалось запустить:', error);
  process.exit(1);
});
