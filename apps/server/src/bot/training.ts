import { type Bot, type Context, InlineKeyboard } from 'grammy';
import type { Task } from '../services/exercises.js';
import { formatWhen } from '../services/srs.js';
import {
  type AnswerResult,
  type Summary,
  answerCard,
  answerChoice,
  answerText,
  nextTask,
  pendingTextTask,
  skipTask,
  startTraining,
  stopTraining,
} from '../services/training.js';
import { escapeHtml } from './format.js';
import { MENU } from './keyboards.js';

const TB = {
  answer: 'ta:', // ta:<seq>:<index>
  card: 'tc:', // tc:<seq>:show|1|0
  skip: 'ts:', // ts:<seq>
  next: 'tnext',
  begin: 'tbegin',
  stop: 'tstop',
} as const;

const HTML = { parse_mode: 'HTML' as const };

function taskText(task: Task): string {
  return (task.retry ? '🔁 <i>Повтор ошибки</i>\n\n' : '') + task.prompt;
}

function taskKeyboard(task: Task): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (task.type === 'card') {
    kb.text('👀 Показать перевод', `${TB.card}${task.seq}:show`).row();
  } else if (task.options) {
    task.options.forEach((option, i) => kb.text(option, `${TB.answer}${task.seq}:${i}`).row());
  } else {
    kb.text('⏭ Пропустить', `${TB.skip}${task.seq}`).row();
  }
  return kb.text('⏹ Закончить', TB.stop);
}

function resultText(result: AnswerResult): string {
  const { task } = result;
  const verdict = result.correct
    ? '✅ <b>Верно!</b>'
    : `❌ <b>Неверно.</b> Правильный ответ: <b>${escapeHtml(task.answer)}</b>`;
  return [taskText(task), '', verdict, result.note ?? '', '', task.reveal]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n');
}

const afterAnswerKeyboard = new InlineKeyboard().text('▶️ Дальше', TB.next).text('⏹ Закончить', TB.stop);

function summaryText(summary: Summary): string {
  const lines = [
    '🏁 <b>Тренировка окончена!</b>',
    '',
    `Верно: <b>${summary.correct}</b> из ${summary.total}`,
    `Перешли на новый уровень: <b>${summary.promoted}</b>`,
  ];
  if (summary.nextDue) lines.push(`Следующее повторение: ${formatWhen(summary.nextDue)}`);
  return lines.join('\n');
}

async function sendTask(ctx: Context, task: Task): Promise<void> {
  await ctx.reply(taskText(task), { ...HTML, reply_markup: taskKeyboard(task) });
}

async function start(ctx: Context): Promise<void> {
  const result = await startTraining(ctx.from!.id);
  if (result.kind === 'no_words') {
    await ctx.reply('Сначала добавь слова: пришли мне слово и нажми «➕ В упражнения».');
    return;
  }
  if (result.kind === 'nothing_due') {
    const when = result.nextDue ? ` Следующее повторение ${formatWhen(result.nextDue)}.` : '';
    await ctx.reply(`На сегодня всё 🎉${when}\nДобавляй новые слова — они сразу попадут в тренировку.`);
    return;
  }
  await ctx.reply(`🏋️ Поехали! Слов в тренировке: <b>${result.total}</b>`, HTML);
  await sendTask(ctx, result.task);
}

/** Показывает результат в том же сообщении, где были кнопки. */
async function showResultInPlace(ctx: Context, result: AnswerResult | null): Promise<void> {
  if (!result) {
    await ctx.answerCallbackQuery('Это задание уже неактуально');
    return;
  }
  await ctx.answerCallbackQuery(result.correct ? '✅' : '❌');
  await ctx
    .editMessageText(resultText(result), { ...HTML, reply_markup: afterAnswerKeyboard })
    .catch(() => undefined);
}

export const BEGIN_TRAINING = TB.begin;

export function registerTraining(bot: Bot): void {
  bot.command('train', start);
  bot.hears(MENU.train, start);

  bot.callbackQuery(TB.begin, async (ctx) => {
    await ctx.answerCallbackQuery();
    await start(ctx);
  });

  bot.callbackQuery(new RegExp(`^${TB.answer}(\\d+):(\\d+)$`), async (ctx) => {
    const result = await answerChoice(ctx.from.id, Number(ctx.match[1]), Number(ctx.match[2]));
    await showResultInPlace(ctx, result);
  });

  bot.callbackQuery(new RegExp(`^${TB.card}(\\d+):(show|1|0)$`), async (ctx) => {
    const seq = Number(ctx.match[1]);
    const action = ctx.match[2];
    if (action === 'show') {
      const pending = await nextTask(ctx.from.id);
      if (pending?.kind !== 'task' || pending.task.seq !== seq) {
        await ctx.answerCallbackQuery('Это задание уже неактуально');
        return;
      }
      await ctx.answerCallbackQuery();
      const kb = new InlineKeyboard()
        .text('✅ Помню', `${TB.card}${seq}:1`)
        .text('❌ Не помню', `${TB.card}${seq}:0`)
        .row()
        .text('⏹ Закончить', TB.stop);
      await ctx
        .editMessageText(`${taskText(pending.task)}\n\n${pending.task.reveal}`, { ...HTML, reply_markup: kb })
        .catch(() => undefined);
      return;
    }
    const result = await answerCard(ctx.from.id, seq, action === '1');
    await showResultInPlace(ctx, result);
  });

  bot.callbackQuery(new RegExp(`^${TB.skip}(\\d+)$`), async (ctx) => {
    const result = await skipTask(ctx.from.id, Number(ctx.match[1]));
    await showResultInPlace(ctx, result);
  });

  bot.callbackQuery(TB.next, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
    const next = await nextTask(ctx.from.id);
    if (!next) {
      await ctx.reply('Тренировка уже закончилась. Начать новую — «🏋️ Тренировка».');
    } else if (next.kind === 'done') {
      await ctx.reply(summaryText(next.summary), HTML);
    } else {
      await sendTask(ctx, next.task);
    }
  });

  bot.callbackQuery(TB.stop, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
    const summary = await stopTraining(ctx.from.id);
    await ctx.reply(summary ? summaryText(summary) : 'Тренировка уже закончилась.', HTML);
  });
}

/**
 * Если тренировка ждёт ответа текстом — обрабатывает его и возвращает true.
 * Иначе возвращает false, и текст уходит на перевод.
 */
export async function handleTrainingText(ctx: Context, text: string): Promise<boolean> {
  const userId = ctx.from!.id;
  const pending = await pendingTextTask(userId);
  if (!pending) return false;
  if (pending.type === 'sentence') await ctx.replyWithChatAction('typing');
  const result = await answerText(userId, text);
  if (!result) return false;
  await ctx.reply(resultText(result), { ...HTML, reply_markup: afterAnswerKeyboard });
  return true;
}
