import type { DictionaryEntry, ExerciseType } from '@english-bot/shared';
import { escapeHtml } from '../utils/html.js';

/** Задание тренировки. Хранится в sessions.state, поэтому только сериализуемые поля. */
export interface Task {
  seq: number;
  wordId: number;
  term: string;
  type: ExerciseType;
  /** Текст задания (HTML). */
  prompt: string;
  /** Что показать после ответа: перевод и пример (HTML). */
  reveal: string;
  /** Правильный ответ для показа. */
  answer: string;
  /** Варианты для заданий с выбором. */
  options?: string[];
  correctIndex?: number;
  /** Допустимые ответы для «напиши слово» (в нижнем регистре). */
  accept?: string[];
  /** Повтор слова после ошибки в этой же сессии — не влияет на коробку. */
  retry: boolean;
}

export interface DistractorPool {
  terms: string[];
  translations: string[];
}

/** Какие упражнения подходят для коробки: от узнавания к употреблению. */
const TYPES_BY_BOX: Record<number, ExerciseType[]> = {
  0: ['card', 'en_ru'],
  1: ['card', 'en_ru', 'ru_en'],
  2: ['en_ru', 'ru_en', 'gap'],
  3: ['ru_en', 'gap', 'write'],
  4: ['gap', 'write', 'sentence'],
  5: ['write', 'sentence'],
};

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

/** 3 неправильных варианта: сначала «путаемые» от ИИ, потом слова пользователя. */
function pickDistractors(correct: string, primary: string[], fallback: string[]): string[] | null {
  const seen = new Set([correct.toLowerCase()]);
  const result: string[] = [];
  for (const candidate of [...shuffle(primary), ...shuffle(fallback)]) {
    const key = candidate.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(candidate.trim());
    if (result.length === 3) return result;
  }
  return null;
}

function mainTranslation(entry: DictionaryEntry): string {
  return entry.translations[0] ?? entry.term;
}

function buildReveal(entry: DictionaryEntry): string {
  const lines = [`<b>${escapeHtml(entry.term)}</b> — ${escapeHtml(entry.translations.join('; '))}`];
  const example = entry.examples[0];
  if (example) {
    lines.push(`<i>${escapeHtml(example.en)}</i>`, `<i>${escapeHtml(example.ru)}</i>`);
  }
  return lines.join('\n');
}

/** Подсказка для «напиши слово»: первая буква и длина, пробелы сохраняем. */
function writeHint(term: string): string {
  return term
    .split(' ')
    .map((word) => word[0] + ' _'.repeat(Math.max(0, word.length - 1)))
    .join('   ');
}

interface BuildInput {
  seq: number;
  wordId: number;
  box: number;
  entry: DictionaryEntry;
  pool: DistractorPool;
  allowSentence: boolean;
  retry: boolean;
}

/** Собирает задание. Если для выбранного типа не хватает данных — пробует другой. */
export function buildTask(input: BuildInput): Task {
  const { entry, pool } = input;
  let types = TYPES_BY_BOX[Math.min(input.box, 5)] ?? ['card'];
  if (!input.allowSentence || input.retry) types = types.filter((t) => t !== 'sentence');
  if (types.length === 0) types = ['write'];

  const base = {
    seq: input.seq,
    wordId: input.wordId,
    term: entry.term,
    reveal: buildReveal(entry),
    retry: input.retry,
  };
  const translation = mainTranslation(entry);

  for (const type of shuffle(types)) {
    switch (type) {
      case 'card': {
        const meta = entry.transcription ? `\n<i>${escapeHtml(entry.transcription)}</i>` : '';
        return {
          ...base,
          type,
          prompt: `🃏 Вспомни перевод:\n\n<b>${escapeHtml(entry.term)}</b>${meta}`,
          answer: translation,
        };
      }
      case 'en_ru': {
        const wrong = pickDistractors(translation, entry.distractors_ru, pool.translations);
        if (!wrong) continue;
        const options = shuffle([translation, ...wrong]);
        return {
          ...base,
          type,
          prompt: `🇬🇧 → 🇷🇺 Как переводится <b>${escapeHtml(entry.term)}</b>?`,
          answer: translation,
          options,
          correctIndex: options.indexOf(translation),
        };
      }
      case 'ru_en': {
        const wrong = pickDistractors(entry.term, entry.distractors_en, pool.terms);
        if (!wrong) continue;
        const options = shuffle([entry.term, ...wrong]);
        return {
          ...base,
          type,
          prompt: `🇷🇺 → 🇬🇧 Как по-английски «<b>${escapeHtml(translation)}</b>»?`,
          answer: entry.term,
          options,
          correctIndex: options.indexOf(entry.term),
        };
      }
      case 'gap': {
        // Предпочитаем примеры, которые пользователь не видел в карточке слова.
        const candidates = entry.examples.length > 2 ? entry.examples.slice(2) : entry.examples;
        if (candidates.length === 0) continue;
        const example = pick(candidates);
        const correct = example.form.toLowerCase();
        const wrong = pickDistractors(correct, entry.distractors_en, pool.terms);
        if (!wrong) continue;
        const options = shuffle([correct, ...wrong.map((w) => w.toLowerCase())]);
        const gapped = example.en.replace(example.form, '_____');
        return {
          ...base,
          type,
          prompt: `✏️ Вставь пропущенное:\n\n<i>${escapeHtml(gapped)}</i>\n(${escapeHtml(example.ru)})`,
          answer: correct,
          options,
          correctIndex: options.indexOf(correct),
        };
      }
      case 'write': {
        const accept = new Set([entry.term.toLowerCase()]);
        return {
          ...base,
          type,
          prompt: `⌨️ Напиши по-английски: «<b>${escapeHtml(translation)}</b>»\n\nПодсказка: <code>${escapeHtml(writeHint(entry.term))}</code>`,
          answer: entry.term,
          accept: [...accept],
        };
      }
      case 'sentence':
        return {
          ...base,
          type,
          prompt: `💬 Составь своё предложение со словом <b>${escapeHtml(entry.term)}</b> (${escapeHtml(translation)}).\n\nНапиши его в ответ — я проверю.`,
          answer: entry.term,
        };
    }
  }

  // Запасной вариант, если не хватило дистракторов и примеров.
  return {
    ...base,
    type: 'card',
    prompt: `🃏 Вспомни перевод:\n\n<b>${escapeHtml(entry.term)}</b>`,
    answer: translation,
  };
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = temp;
    }
  }
  return prev[b.length]!;
}

export type WriteCheck = 'exact' | 'typo' | 'wrong';

/** Проверка «напиши слово»: допускаем одну опечатку для слов от 5 букв. */
export function checkWritten(input: string, accept: string[]): WriteCheck {
  const answer = input.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
  if (accept.includes(answer)) return 'exact';
  const typo = accept.some((a) => a.length >= 5 && levenshtein(answer, a) <= 1);
  return typo ? 'typo' : 'wrong';
}
