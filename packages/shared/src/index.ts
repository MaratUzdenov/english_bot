// Общие типы и схемы для сервера и Mini App.
import { z } from 'zod';

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

/** Пример употребления: form — точная форма слова внутри en (для упражнения с пропуском). */
export const exampleSchema = z.object({
  en: z.string().min(1),
  ru: z.string().min(1),
  form: z.string().min(1),
});
export type Example = z.infer<typeof exampleSchema>;

/** Ответ ИИ по слову — хранится в dictionary_cache.payload. Описание полей: exercises.md. */
export const dictionaryEntrySchema = z.object({
  term: z.string().min(1),
  is_valid: z.boolean(),
  suggestion: z.string().nullable().optional(),
  transcription: z.string().nullable().optional(),
  part_of_speech: z.string().nullable().optional(),
  level: z.string().nullable().optional(),
  translations: z.array(z.string().min(1)).default([]),
  examples: z.array(exampleSchema).default([]),
  collocations: z.array(z.string()).default([]),
  distractors_en: z.array(z.string()).default([]),
  distractors_ru: z.array(z.string()).default([]),
});
export type DictionaryEntry = z.infer<typeof dictionaryEntrySchema>;
