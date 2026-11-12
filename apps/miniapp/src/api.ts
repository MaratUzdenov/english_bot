import { tg } from './telegram';

const API_URL = import.meta.env.VITE_API_URL ?? 'https://marat-english-words.duckdns.org:8443';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `tma ${tg?.initData ?? ''}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'unknown');
  return data as T;
}

// ---------- типы ответов (зеркало apps/server/src/api/server.ts) ----------

export interface Stats {
  totalWords: number;
  newWords: number;
  learning: number;
  learned: number;
  dueNow: number;
  byBox: number[];
  lookups: number;
  reviewsToday: number;
  accuracy: number | null;
  accuracyToday: number | null;
  streak: number;
  trainedToday: boolean;
}

export interface WordItem {
  id: number;
  term: string;
  translation: string | null;
  box: number;
}

export interface WordsPage {
  items: WordItem[];
  page: number;
  totalPages: number;
  total: number;
}

export interface DictionaryEntry {
  term: string;
  is_valid: boolean;
  suggestion?: string | null;
  transcription?: string | null;
  part_of_speech?: string | null;
  level?: string | null;
  translations: string[];
  examples: { en: string; ru: string; form: string }[];
  collocations: string[];
}

export interface LookupResult {
  lookupId: number;
  inExercises: boolean;
  entry: DictionaryEntry;
}

export type ExerciseType = 'card' | 'en_ru' | 'ru_en' | 'gap' | 'write' | 'sentence';

export interface Task {
  seq: number;
  type: ExerciseType;
  term: string;
  prompt: string; // HTML, экранирован на сервере
  options: string[] | null;
  retry: boolean;
  reveal: string | null; // HTML; только для карточки
}

export interface AnswerResult {
  correct: boolean;
  answer: string;
  correctIndex: number | null;
  note: string | null; // HTML
  reveal: string; // HTML
}

export interface Summary {
  total: number;
  correct: number;
  promoted: number;
  nextDue: string | null;
}

export type StartResponse =
  | { kind: 'task'; total: number; task: Task }
  | { kind: 'nothing_due'; nextDue: string | null }
  | { kind: 'no_words' };

export type CurrentResponse =
  | { kind: 'task'; task: Task }
  | { kind: 'done'; summary: Summary }
  | { kind: 'none' };

export type Answer =
  | { kind: 'choice'; seq: number; index: number }
  | { kind: 'card'; seq: number; remembered: boolean }
  | { kind: 'text'; seq: number; text: string }
  | { kind: 'skip'; seq: number };

export const api = {
  me: () => request<{ id: number; firstName: string | null }>('GET', '/api/me'),
  stats: () => request<Stats>('GET', '/api/stats'),
  words: (page: number) => request<WordsPage>('GET', `/api/words?page=${page}`),
  deleteWord: (id: number) => request<{ ok: true }>('DELETE', `/api/words/${id}`),
  lookup: (text: string) => request<LookupResult>('POST', '/api/lookup', { text }),
  addWord: (lookupId: number) =>
    request<{ result: 'added' | 'exists' | 'not_found' }>('POST', '/api/words', { lookupId }),
  startTraining: () => request<StartResponse>('POST', '/api/training/start'),
  currentTask: () => request<CurrentResponse>('GET', '/api/training/current'),
  answer: (answer: Answer) => request<AnswerResult>('POST', '/api/training/answer', answer),
  stopTraining: () => request<{ summary: Summary | null }>('POST', '/api/training/stop'),
  exportToChat: () => request<{ sent: boolean; count: number }>('POST', '/api/export'),
};

const ERROR_TEXT: Record<string, string> = {
  unauthorized: 'Открой приложение через бота в Telegram.',
  closed_beta: 'Бот пока в закрытом тесте 🙏',
  cyrillic: 'Напиши слово на английском 🙂',
  too_long: 'Слишком длинно — до 6 слов.',
  not_english: 'Используй латинские буквы.',
  llm_limit: 'Дневной лимит переводов исчерпан, попробуй позже.',
  llm_unavailable: 'Сервис перевода недоступен, попробуй через минуту.',
  stale_task: 'Задание устарело — загружаю следующее.',
};

export function errorText(error: unknown): string {
  if (error instanceof ApiError) return ERROR_TEXT[error.code] ?? `Ошибка сервера (${error.status})`;
  return 'Нет связи с сервером. Проверь интернет.';
}

export function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'уже сейчас';
  const hours = Math.round(diff / 3_600_000);
  if (hours < 1) return 'меньше чем через час';
  if (hours < 24) return `через ${hours} ч`;
  const days = Math.round(diff / 86_400_000);
  return days === 1 ? 'завтра' : `через ${days} дн.`;
}
