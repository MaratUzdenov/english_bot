import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import type { ExerciseType, WordStatus } from '@english-bot/shared';

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** Пользователи бота. id = Telegram ID. */
export const users = pgTable('users', {
  id: bigint('id', { mode: 'number' }).primaryKey(),
  username: text('username'),
  firstName: text('first_name'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

/** Ответы ИИ по словам: общий кэш на всех пользователей. term — нормализованное слово. */
export const dictionaryCache = pgTable('dictionary_cache', {
  term: text('term').primaryKey(),
  payload: jsonb('payload').notNull(),
  provider: text('provider').notNull(),
  createdAt: createdAt(),
});

/** Каждый запрос перевода — для экспорта «всё, что когда-либо писал». */
export const lookups = pgTable(
  'lookups',
  {
    id: serial('id').primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    query: text('query').notNull(),
    term: text('term'),
    createdAt: createdAt(),
  },
  (t) => [index('lookups_user_idx').on(t.userId, t.createdAt)],
);

/** Слова, добавленные в упражнения. Данные слова — в dictionary_cache по term. */
export const words = pgTable(
  'words',
  {
    id: serial('id').primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    term: text('term').notNull(),
    box: integer('box').notNull().default(0),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull().defaultNow(),
    correctCount: integer('correct_count').notNull().default(0),
    wrongCount: integer('wrong_count').notNull().default(0),
    status: text('status').$type<WordStatus>().notNull().default('learning'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('words_user_term_uq').on(t.userId, t.term),
    index('words_due_idx').on(t.userId, t.dueAt),
  ],
);

/** История ответов в упражнениях — для статистики, точности и серии дней. */
export const reviews = pgTable(
  'reviews',
  {
    id: serial('id').primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    wordId: integer('word_id')
      .notNull()
      .references(() => words.id, { onDelete: 'cascade' }),
    exerciseType: text('exercise_type').$type<ExerciseType>().notNull(),
    isCorrect: boolean('is_correct').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('reviews_user_idx').on(t.userId, t.createdAt)],
);

/** Состояние текущей тренировки пользователя (какое задание ждёт ответа). */
export const sessions = pgTable('sessions', {
  userId: bigint('user_id', { mode: 'number' })
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  state: jsonb('state').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
