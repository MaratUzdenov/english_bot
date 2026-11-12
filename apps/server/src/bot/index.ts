import { Bot, type Context } from 'grammy';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { checkInput, lookupTerm } from '../services/dictionary.js';
import { LlmUnavailableError } from '../services/llm.js';
import { addWordFromLookup, deleteWord, getWordsPage } from '../services/words.js';
import { escapeHtml, formatEntry, formatWordsPage } from './format.js';
import { CB, MENU, addKeyboard, mainMenu, wordsKeyboard } from './keyboards.js';
import { handleTrainingText, registerTraining } from './training.js';

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

// ---------- Мои слова ----------

async function sendWords(ctx: Context, page: number, edit: boolean): Promise<void> {
  const data = await getWordsPage(ctx.from!.id, page);
  const text = formatWordsPage(data);
  const options = {
    parse_mode: 'HTML' as const,
    reply_markup: data.total > 0 ? wordsKeyboard(data) : undefined,
  };
  if (edit) {
    await ctx.editMessageText(text, options).catch(() => undefined); // «message is not modified» — не ошибка
  } else {
    await ctx.reply(text, options);
  }
}

bot.command('words', (ctx) => sendWords(ctx, 0, false));
bot.hears(MENU.words, (ctx) => sendWords(ctx, 0, false));

bot.callbackQuery(new RegExp(`^${CB.words}(\\d+)$`), async (ctx) => {
  await ctx.answerCallbackQuery();
  await sendWords(ctx, Number(ctx.match[1]), true);
});

bot.callbackQuery(new RegExp(`^${CB.del}(\\d+):(\\d+)$`), async (ctx) => {
  const deleted = await deleteWord(ctx.from.id, Number(ctx.match[1]));
  await ctx.answerCallbackQuery(deleted ? 'Удалено' : 'Уже удалено');
  await sendWords(ctx, Number(ctx.match[2]), true);
});

// ---------- Добавление в упражнения ----------

bot.callbackQuery(new RegExp(`^${CB.add}(\\d+)$`), async (ctx) => {
  const lookupId = Number(ctx.match[1]);
  const result = await addWordFromLookup(ctx.from.id, lookupId);
  const messages = {
    added: '✅ Добавлено в упражнения',
    exists: 'Это слово уже в упражнениях',
    not_found: 'Не нашёл это слово, пришли его ещё раз',
  } as const;
  await ctx.answerCallbackQuery(messages[result]);
  if (result !== 'not_found') {
    await ctx.editMessageReplyMarkup({ reply_markup: addKeyboard(lookupId, true) }).catch(() => undefined);
  }
});

bot.callbackQuery(CB.noop, (ctx) => ctx.answerCallbackQuery());

// ---------- Тренировка ----------

registerTraining(bot);

// ---------- Заглушки (шаг 5) ----------

const soon = (step: number) => `Скоро будет — это шаг ${step} 🛠`;
bot.hears(MENU.progress, (ctx) => ctx.reply(soon(5)));
bot.hears(MENU.export, (ctx) => ctx.reply(soon(5)));

// ---------- Перевод: любой другой текст ----------

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) {
    await ctx.reply('Не знаю такой команды. Смотри /help');
    return;
  }

  // Если тренировка ждёт ответа текстом — это ответ, а не слово для перевода.
  if (await handleTrainingText(ctx, text)) return;

  const check = checkInput(text);
  if (!check.ok) {
    const reasons = {
      cyrillic: 'Пришли слово на английском 🙂 Перевод с русского добавим позже.',
      too_long: 'Слишком длинно. Пришли слово или короткую фразу (до 6 слов).',
      not_english: 'Не похоже на английское слово. Используй латинские буквы.',
    } as const;
    await ctx.reply(reasons[check.reason]);
    return;
  }

  await ctx.replyWithChatAction('typing');

  try {
    const result = await lookupTerm(ctx.from.id, text, check.term);
    const { entry } = result;

    if (!entry.is_valid) {
      const hint = entry.suggestion
        ? ` Возможно, ты имел(а) в виду <b>${escapeHtml(entry.suggestion)}</b>? Пришли его.`
        : '';
      await ctx.reply(`Не нашёл такое слово 🤔${hint}`, { parse_mode: 'HTML' });
      return;
    }

    await ctx.reply(formatEntry(entry), {
      parse_mode: 'HTML',
      reply_markup: addKeyboard(result.lookupId, result.inExercises),
      link_preview_options: { is_disabled: true },
    });
  } catch (error) {
    if (error instanceof LlmUnavailableError) {
      const limit = error.causes.some((c) => c.isRateLimit);
      await ctx.reply(
        limit
          ? 'Дневной лимит переводов исчерпан 😔 Попробуй позже — уже переведённые слова по-прежнему открываются.'
          : 'Сервис перевода сейчас недоступен, попробуй через минуту.',
      );
    } else {
      console.error('Lookup failed:', error);
      await ctx.reply('Что-то пошло не так при переводе, попробуй ещё раз.');
    }
  }
});

bot.catch((err) => {
  console.error(`Ошибка при обработке update ${err.ctx.update.update_id}:`, err.error);
});

export async function setupBotCommands(): Promise<void> {
  await bot.api.setMyCommands([
    { command: 'start', description: 'Начать' },
    { command: 'train', description: 'Тренировка' },
    { command: 'words', description: 'Мои слова' },
    { command: 'help', description: 'Как пользоваться' },
  ]);
}
