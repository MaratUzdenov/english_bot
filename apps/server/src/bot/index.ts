import { Bot } from 'grammy';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { MENU, mainMenu } from './keyboards.js';

export const bot = new Bot(config.botToken);

// 1. Белый список: посторонние не тратят лимиты ИИ.
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (userId === undefined) return;
  if (!config.allowedUsers.has(userId)) {
    if (ctx.chat?.type === 'private') {
      await ctx.reply('Бот пока в закрытом тесте 🙏');
    }
    console.warn(`Blocked user ${userId} (@${ctx.from?.username ?? '—'})`);
    return;
  }
  await next();
});

// 2. Сохраняем или обновляем пользователя при каждом обращении.
bot.use(async (ctx, next) => {
  const from = ctx.from;
  if (from) {
    await db
      .insert(users)
      .values({ id: from.id, username: from.username, firstName: from.first_name })
      .onConflictDoUpdate({
        target: users.id,
        set: { username: from.username, firstName: from.first_name },
      });
  }
  await next();
});

bot.command('start', async (ctx) => {
  const name = ctx.from?.first_name ?? 'друг';
  await ctx.reply(
    [
      `Привет, ${name}! 👋`,
      '',
      'Пришли мне английское слово или фразу — я переведу и покажу примеры.',
      'Понравилось слово — добавь его в упражнения, и я помогу его запомнить.',
    ].join('\n'),
    { reply_markup: mainMenu },
  );
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    [
      'Как пользоваться:',
      '• пришли слово или фразу → перевод и примеры',
      `• ${MENU.train} — упражнения по твоим словам`,
      `• ${MENU.progress} — статистика`,
      `• ${MENU.words} — список слов`,
      `• ${MENU.export} — выгрузить все слова в CSV`,
    ].join('\n'),
    { reply_markup: mainMenu },
  );
});

// Заглушки — наполним на шагах 3–5.
const soon = (step: number) => `Скоро будет — это шаг ${step} 🛠`;
bot.hears(MENU.train, (ctx) => ctx.reply(soon(4)));
bot.hears(MENU.progress, (ctx) => ctx.reply(soon(5)));
bot.hears(MENU.words, (ctx) => ctx.reply(soon(3)));
bot.hears(MENU.export, (ctx) => ctx.reply(soon(5)));

// Любой другой текст — запрос перевода (шаг 2).
bot.on('message:text', async (ctx) => {
  await ctx.reply(`Перевод «${ctx.message.text}» появится на шаге 2 🛠`);
});

bot.catch((err) => {
  console.error(`Ошибка при обработке update ${err.ctx.update.update_id}:`, err.error);
});

export async function setupBotCommands(): Promise<void> {
  await bot.api.setMyCommands([
    { command: 'start', description: 'Начать' },
    { command: 'help', description: 'Как пользоваться' },
  ]);
}
