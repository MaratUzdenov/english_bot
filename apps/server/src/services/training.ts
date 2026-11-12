import { and, asc, eq, gt, gte, lte, min, sql } from 'drizzle-orm';
import { type DictionaryEntry, dictionaryEntrySchema } from '@english-bot/shared';
import { escapeHtml } from '../utils/html.js';
import { db } from '../db/client.js';
import { dictionaryCache, reviews, sessions, words } from '../db/schema.js';
import { buildTask, checkWritten, type DistractorPool, type Task } from './exercises.js';
import { generateJson } from './llm.js';
import { applyAnswer } from './srs.js';

export const SESSION_SIZE = 10;
const MAX_NEW_PER_SESSION = 5;
export const SENTENCE_DAILY_LIMIT = 20;

interface QueueItem {
  wordId: number;
  retry: boolean;
}

export interface TrainingState {
  queue: QueueItem[];
  seq: number;
  total: number;
  correct: number;
  promoted: number;
  current: Task | null;
}

export interface Summary {
  total: number;
  correct: number;
  promoted: number;
  nextDue: Date | null;
}

export interface AnswerResult {
  correct: boolean;
  task: Task;
  /** Дополнительный текст: опечатка, разбор предложения от ИИ. */
  note?: string;
}

// ---------- хранение состояния ----------

async function loadState(userId: number): Promise<TrainingState | null> {
  const [row] = await db.select().from(sessions).where(eq(sessions.userId, userId));
  return row ? (row.state as TrainingState) : null;
}

async function saveState(userId: number, state: TrainingState): Promise<void> {
  await db
    .insert(sessions)
    .values({ userId, state })
    .onConflictDoUpdate({ target: sessions.userId, set: { state, updatedAt: new Date() } });
}

async function clearState(userId: number): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

// ---------- данные для заданий ----------

async function getEntry(term: string): Promise<DictionaryEntry | null> {
  const [row] = await db
    .select({ payload: dictionaryCache.payload })
    .from(dictionaryCache)
    .where(eq(dictionaryCache.term, term));
  const parsed = dictionaryEntrySchema.safeParse(row?.payload);
  return parsed.success ? parsed.data : null;
}

/** Слова и переводы пользователя — запасные неправильные варианты. */
async function getPool(userId: number): Promise<DistractorPool> {
  const rows = await db
    .select({
      term: words.term,
      translation: sql<string | null>`${dictionaryCache.payload} -> 'translations' ->> 0`,
    })
    .from(words)
    .leftJoin(dictionaryCache, eq(dictionaryCache.term, words.term))
    .where(eq(words.userId, userId))
    .orderBy(sql`random()`)
    .limit(40);
  return {
    terms: rows.map((r) => r.term),
    translations: rows.map((r) => r.translation).filter((t): t is string => Boolean(t)),
  };
}

async function sentenceChecksToday(userId: number): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(reviews)
    .where(
      and(
        eq(reviews.userId, userId),
        eq(reviews.exerciseType, 'sentence'),
        gte(reviews.createdAt, startOfDay),
      ),
    );
  return row?.value ?? 0;
}

export async function getNextDue(userId: number): Promise<Date | null> {
  const [row] = await db
    .select({ value: min(words.dueAt) })
    .from(words)
    .where(and(eq(words.userId, userId), gt(words.dueAt, new Date())));
  return row?.value ?? null;
}

// ---------- сессия ----------

export type StartResult =
  | { kind: 'task'; task: Task; total: number }
  | { kind: 'no_words' }
  | { kind: 'nothing_due'; nextDue: Date | null };

/** Новая сессия: сначала слова, которым пора повториться, затем новые (не больше 5). */
export async function startTraining(userId: number): Promise<StartResult> {
  const now = new Date();
  const due = await db
    .select({ id: words.id })
    .from(words)
    .where(and(eq(words.userId, userId), gt(words.box, 0), lte(words.dueAt, now)))
    .orderBy(asc(words.dueAt))
    .limit(SESSION_SIZE);

  const freeSlots = Math.min(MAX_NEW_PER_SESSION, SESSION_SIZE - due.length);
  const fresh =
    freeSlots > 0
      ? await db
          .select({ id: words.id })
          .from(words)
          .where(and(eq(words.userId, userId), eq(words.box, 0)))
          .orderBy(asc(words.createdAt))
          .limit(freeSlots)
      : [];

  const ids = [...due, ...fresh].map((w) => w.id);
  if (ids.length === 0) {
    const [any] = await db.select({ id: words.id }).from(words).where(eq(words.userId, userId)).limit(1);
    if (!any) return { kind: 'no_words' };
    return { kind: 'nothing_due', nextDue: await getNextDue(userId) };
  }

  const state: TrainingState = {
    queue: ids.map((wordId) => ({ wordId, retry: false })),
    seq: 0,
    total: ids.length,
    correct: 0,
    promoted: 0,
    current: null,
  };
  const next = await advance(userId, state);
  if (next.kind === 'task') return { kind: 'task', task: next.task, total: state.total };
  return { kind: 'nothing_due', nextDue: await getNextDue(userId) };
}

export type NextResult = { kind: 'task'; task: Task } | { kind: 'done'; summary: Summary };

/** Берёт следующее слово из очереди и строит задание. */
async function advance(userId: number, state: TrainingState): Promise<NextResult> {
  const pool = await getPool(userId);
  const allowSentence = (await sentenceChecksToday(userId)) < SENTENCE_DAILY_LIMIT;

  while (state.queue.length > 0) {
    const item = state.queue.shift()!;
    const [word] = await db
      .select()
      .from(words)
      .where(and(eq(words.id, item.wordId), eq(words.userId, userId)));
    if (!word) continue; // слово удалили во время тренировки
    const entry = await getEntry(word.term);
    if (!entry) continue;

    state.seq += 1;
    state.current = buildTask({
      seq: state.seq,
      wordId: word.id,
      box: word.box,
      entry,
      pool,
      allowSentence,
      retry: item.retry,
    });
    await saveState(userId, state);
    return { kind: 'task', task: state.current };
  }

  await clearState(userId);
  return {
    kind: 'done',
    summary: {
      total: state.total,
      correct: state.correct,
      promoted: state.promoted,
      nextDue: await getNextDue(userId),
    },
  };
}

export async function nextTask(userId: number): Promise<NextResult | null> {
  const state = await loadState(userId);
  if (!state) return null;
  if (state.current) return { kind: 'task', task: state.current };
  return advance(userId, state);
}

export async function stopTraining(userId: number): Promise<Summary | null> {
  const state = await loadState(userId);
  if (!state) return null;
  await clearState(userId);
  return {
    total: state.total,
    correct: state.correct,
    promoted: state.promoted,
    nextDue: await getNextDue(userId),
  };
}

/** Записывает ответ: обновляет коробку и историю (кроме повторов после ошибки). */
async function record(
  userId: number,
  state: TrainingState,
  correct: boolean,
  affectsSrs = true,
): Promise<void> {
  const task = state.current!;
  if (!task.retry && affectsSrs) {
    const [word] = await db
      .select({ box: words.box, status: words.status })
      .from(words)
      .where(eq(words.id, task.wordId));
    if (word) {
      const update = applyAnswer(word, correct);
      await db
        .update(words)
        .set({
          box: update.box,
          status: update.status,
          dueAt: update.dueAt,
          correctCount: correct ? sql`${words.correctCount} + 1` : words.correctCount,
          wrongCount: correct ? words.wrongCount : sql`${words.wrongCount} + 1`,
        })
        .where(eq(words.id, task.wordId));
      if (update.promoted) state.promoted += 1;
      await db
        .insert(reviews)
        .values({ userId, wordId: task.wordId, exerciseType: task.type, isCorrect: correct });
    }
    if (correct) state.correct += 1;
  }
  // Ошибку повторяем один раз в конце сессии.
  if (!correct && !task.retry) state.queue.push({ wordId: task.wordId, retry: true });
  state.current = null;
  await saveState(userId, state);
}

async function currentTask(userId: number, seq: number): Promise<{ state: TrainingState; task: Task } | null> {
  const state = await loadState(userId);
  if (!state?.current || state.current.seq !== seq) return null; // старая кнопка
  return { state, task: state.current };
}

export async function answerChoice(userId: number, seq: number, index: number): Promise<AnswerResult | null> {
  const found = await currentTask(userId, seq);
  if (!found || found.task.correctIndex === undefined) return null;
  const correct = index === found.task.correctIndex;
  await record(userId, found.state, correct);
  return { correct, task: found.task };
}

export async function answerCard(userId: number, seq: number, remembered: boolean): Promise<AnswerResult | null> {
  const found = await currentTask(userId, seq);
  if (!found || found.task.type !== 'card') return null;
  await record(userId, found.state, remembered);
  return { correct: remembered, task: found.task };
}

export async function skipTask(userId: number, seq: number): Promise<AnswerResult | null> {
  const found = await currentTask(userId, seq);
  if (!found) return null;
  // Пропуск «своего предложения» не наказываем, остальное — как ошибка.
  await record(userId, found.state, false, found.task.type !== 'sentence');
  return { correct: false, task: found.task };
}

/** Есть ли задание, которое ждёт ответа текстом. */
export async function pendingTextTask(userId: number): Promise<Task | null> {
  const state = await loadState(userId);
  const task = state?.current;
  return task && (task.type === 'write' || task.type === 'sentence') ? task : null;
}

interface SentenceCheck {
  uses_word: boolean;
  is_correct: boolean;
  corrected: string;
  explanation_ru: string;
}

async function checkSentence(task: Task, sentence: string): Promise<SentenceCheck | null> {
  const prompt = `You are a friendly English teacher for a Russian-speaking learner (B1-B2).
Target word/phrase: "${task.term}" (meaning: ${task.answer}).
Student's sentence: "${sentence.replace(/"/g, "'")}"

Check whether the sentence uses the target word/phrase (any grammatical form) correctly and naturally.
Reply with valid JSON only, no markdown:
{"uses_word":true,"is_correct":true,"corrected":"corrected full sentence (or the same if fine)","explanation_ru":"1-2 short sentences in Russian: what is good or what to fix"}
"is_correct" is true if the target word is used correctly in meaning and grammar; small unrelated mistakes should be mentioned in explanation_ru but do not make it false.`;
  try {
    const { json } = await generateJson(prompt);
    const data = json as Partial<SentenceCheck>;
    if (typeof data.is_correct !== 'boolean') return null;
    return {
      uses_word: data.uses_word !== false,
      is_correct: data.is_correct,
      corrected: String(data.corrected ?? sentence),
      explanation_ru: String(data.explanation_ru ?? ''),
    };
  } catch (error) {
    console.warn('[training] sentence check failed:', error);
    return null;
  }
}

/** Ответ текстом на «напиши слово» или «составь предложение». */
export async function answerText(userId: number, text: string, seq?: number): Promise<AnswerResult | null> {
  const state = await loadState(userId);
  const task = state?.current;
  if (!state || !task) return null;
  if (seq !== undefined && task.seq !== seq) return null;

  if (task.type === 'write') {
    const check = checkWritten(text, task.accept ?? [task.term.toLowerCase()]);
    const correct = check !== 'wrong';
    await record(userId, state, correct);
    return {
      correct,
      task,
      note: check === 'typo' ? `Засчитано, но с опечаткой. Правильно: <b>${escapeHtml(task.answer)}</b>` : undefined,
    };
  }

  if (task.type === 'sentence') {
    const result = await checkSentence(task, text);
    if (!result) {
      await record(userId, state, true);
      return { correct: true, task, note: 'Не получилось проверить через ИИ — засчитываю 🙂' };
    }
    const correct = result.uses_word && result.is_correct;
    await record(userId, state, correct);
    const lines = [escapeHtml(result.explanation_ru)];
    if (result.corrected.trim() && result.corrected.trim() !== text.trim()) {
      lines.push(`Лучше так: <i>${escapeHtml(result.corrected)}</i>`);
    }
    if (!result.uses_word) lines.unshift(`В предложении нет слова «${escapeHtml(task.term)}».`);
    return { correct, task, note: lines.filter(Boolean).join('\n') };
  }

  return null;
}

/** Есть ли у пользователя активная тренировка (для текста вне упражнений). */
export async function hasActiveTraining(userId: number): Promise<boolean> {
  return (await loadState(userId)) !== null;
}

