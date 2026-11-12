// Общие типы для сервера и Mini App. Схема ответа ИИ и типы упражнений появятся на шагах 2 и 4.

export const WORD_STATUSES = ['learning', 'learned'] as const;
export type WordStatus = (typeof WORD_STATUSES)[number];

export const EXERCISE_TYPES = [
  'card',
  'en_ru',
  'ru_en',
  'gap',
  'write',
  'sentence',
] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

/** Интервалы Лейтнера в днях, индекс = номер коробки (0–5). */
export const LEITNER_INTERVALS_DAYS = [0, 1, 3, 7, 16, 35] as const;

/** Приводит слово к виду, в котором оно хранится в БД и кэше. */
export function normalizeTerm(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ');
}
