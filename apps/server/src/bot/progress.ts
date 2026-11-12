import { type Bot, type Context, InlineKeyboard, InputFile } from 'grammy';
import { buildExportXlsx } from '../services/export.js';
import { type Stats, getStats } from '../services/stats.js';
import { MENU } from './keyboards.js';
import { BEGIN_TRAINING } from './training.js';

const BOX_ICONS = ['⚪', '🔴', '🟠', '🟡', '🟢', '🔵'];

export function formatStats(s: Stats): string {
  if (s.totalWords === 0 && s.lookups === 0) {
    return '📊 Пока нечего показывать. Пришли мне английское слово — и начнём!';
  }
  const streakLine =
    s.streak > 0
      ? `🔥 Серия: <b>${s.streak}</b> дн. подряд${s.trainedToday ? ' (сегодня ✅)' : ' — потренируйся сегодня, чтобы не прервать'}`
      : '🔥 Серия: 0 — начни сегодня!';
  const accuracy =
    s.accuracy === null
      ? '🎯 Точность: ещё не было тренировок'
      : `🎯 Точность: <b>${s.accuracy}%</b>` +
        (s.accuracyToday !== null ? ` (сегодня ${s.accuracyToday}%, ответов: ${s.reviewsToday})` : '');
  const boxes = s.byBox.map((count, box) => `${BOX_ICONS[box]}${count}`).join('  ');

  return [
    '📊 <b>Твой прогресс</b>',
    '',
    streakLine,
    `📚 Слов в упражнениях: <b>${s.totalWords}</b>`,
    `   новые: ${s.newWords} · изучаются: ${s.learning} · выучено: <b>${s.learned}</b>`,
    `⏰ Ждут повторения: <b>${s.dueNow}</b>`,
    accuracy,
    `🔎 Переведено всего: ${s.lookups}`,
    '',
    `По уровням: ${boxes}`,
    '<i>⚪ новое → 🔴🟠🟡🟢 → 🔵 почти выучено</i>',
  ].join('\n');
}

async function sendProgress(ctx: Context): Promise<void> {
  const stats = await getStats(ctx.from!.id);
  const kb = stats.dueNow > 0 ? new InlineKeyboard().text(`🏋️ Повторить (${stats.dueNow})`, BEGIN_TRAINING) : undefined;
  await ctx.reply(formatStats(stats), { parse_mode: 'HTML', reply_markup: kb });
}

async function sendExport(ctx: Context): Promise<void> {
  await ctx.replyWithChatAction('upload_document');
  const { file, count } = await buildExportXlsx(ctx.from!.id);
  if (count === 0) {
    await ctx.reply('Пока нечего выгружать — пришли мне слово для перевода.');
    return;
  }
  const date = new Date().toISOString().slice(0, 10);
  await ctx.replyWithDocument(new InputFile(file, `english-words-${date}.xlsx`), {
    caption: `📤 Все слова, которые ты присылал(а): ${count}.\nОткрывается в Excel и Google Таблицах.`,
  });
}

export function registerProgress(bot: Bot): void {
  bot.command('progress', sendProgress);
  bot.hears(MENU.progress, sendProgress);
  bot.command('export', sendExport);
  bot.hears(MENU.export, sendExport);
}
