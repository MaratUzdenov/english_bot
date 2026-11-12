import { and, count, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { dictionaryCache, lookups, words } from '../db/schema.js';

export const WORDS_PAGE_SIZE = 10;

export type AddResult = 'added' | 'exists' | 'not_found';

/** Добавляет слово из запроса перевода в упражнения. */
export async function addWordFromLookup(userId: number, lookupId: number): Promise<AddResult> {
  const [lookup] = await db
    .select({ term: lookups.term })
    .from(lookups)
    .where(and(eq(lookups.id, lookupId), eq(lookups.userId, userId)));
  if (!lookup?.term) return 'not_found';

  const inserted = await db
    .insert(words)
    .values({ userId, term: lookup.term })
    .onConflictDoNothing()
    .returning({ id: words.id });
  return inserted.length > 0 ? 'added' : 'exists';
}

export async function deleteWord(userId: number, wordId: number): Promise<boolean> {
  const deleted = await db
    .delete(words)
    .where(and(eq(words.id, wordId), eq(words.userId, userId)))
    .returning({ id: words.id });
  return deleted.length > 0;
}

export interface WordListItem {
  id: number;
  term: string;
  translation: string | null;
  box: number;
}

export interface WordsPage {
  items: WordListItem[];
  page: number;
  totalPages: number;
  total: number;
}

/** Страница слов пользователя, новые сверху. Перевод — первый из кэша словаря. */
export async function getWordsPage(userId: number, page: number): Promise<WordsPage> {
  const [totalRow] = await db.select({ value: count() }).from(words).where(eq(words.userId, userId));
  const total = totalRow?.value ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / WORDS_PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);

  const items = await db
    .select({
      id: words.id,
      term: words.term,
      box: words.box,
      translation: sql<string | null>`${dictionaryCache.payload} -> 'translations' ->> 0`,
    })
    .from(words)
    .leftJoin(dictionaryCache, eq(dictionaryCache.term, words.term))
    .where(eq(words.userId, userId))
    .orderBy(desc(words.createdAt), desc(words.id))
    .limit(WORDS_PAGE_SIZE)
    .offset(safePage * WORDS_PAGE_SIZE);

  return { items, page: safePage, totalPages, total };
}
