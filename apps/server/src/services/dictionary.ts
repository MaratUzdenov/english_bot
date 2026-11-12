import { and, eq } from 'drizzle-orm';
import {
  type DictionaryEntry,
  dictionaryEntrySchema,
  normalizeTerm,
} from '@english-bot/shared';
import { db } from '../db/client.js';
import { dictionaryCache, lookups, words } from '../db/schema.js';
import { generateJson } from './llm.js';

const MAX_LENGTH = 60;
const MAX_WORDS = 6;

export type InputCheck =
  | { ok: true; term: string }
  | { ok: false; reason: 'cyrillic' | 'too_long' | 'not_english' };

/** Проверяет, похоже ли сообщение на английское слово или короткую фразу. */
export function checkInput(text: string): InputCheck {
  const term = normalizeTerm(text);
  if (/[а-яё]/i.test(term)) return { ok: false, reason: 'cyrillic' };
  if (term.length > MAX_LENGTH || term.split(' ').length > MAX_WORDS) {
    return { ok: false, reason: 'too_long' };
  }
  if (!/^[a-z][a-z' .,!?-]*$/.test(term)) return { ok: false, reason: 'not_english' };
  return { ok: true, term: term.replace(/[.,!?]+$/, '') };
}

function buildPrompt(term: string): string {
  return `You are an English–Russian dictionary for a Russian-speaking learner (B1–B2).
Analyse the English word or phrase: "${term}".

Fields:
- term: the word/phrase in dictionary form, lowercase ("took off" -> "take off")
- is_valid: false if it is not a real English word/phrase or has a typo
- suggestion: if is_valid is false, the most likely intended English word, otherwise null
- transcription: British IPA in slashes
- part_of_speech: in Russian, e.g. "фразовый глагол", "существительное"
- level: CEFR level (A1, A2, B1, B2, C1 or C2)
- translations: 1-3 most common Russian translations, most frequent first; add a short clarification in parentheses if meanings differ
- examples: 6 natural everyday sentences (6-14 words) covering different meanings; "form" is the exact substring of "en" where the word/phrase appears, with its inflection and letter case
- collocations: 2-4 common English collocations
- distractors_en: 4 English words/phrases a learner could confuse with it (similar spelling or meaning), same part of speech
- distractors_ru: 4 plausible but WRONG Russian translations
If is_valid is false, the arrays may be empty.

Reply with valid JSON only (no comments, no markdown), exactly in this shape:
{"term":"take off","is_valid":true,"suggestion":null,"transcription":"/teɪk ɒf/","part_of_speech":"фразовый глагол","level":"B1","translations":["взлетать","снимать (одежду)"],"examples":[{"en":"The plane took off on time.","ru":"Самолёт взлетел вовремя.","form":"took off"}],"collocations":["take off a jacket"],"distractors_en":["take on","take over","put off","take up"],"distractors_ru":["приземляться","надевать","откладывать","брать на себя"]}`;
}

/** Убирает примеры, где form не встречается в предложении — иначе упражнение с пропуском сломается. */
function sanitize(entry: DictionaryEntry): DictionaryEntry {
  return {
    ...entry,
    term: normalizeTerm(entry.term),
    examples: entry.examples.filter((ex) => ex.en.includes(ex.form)),
  };
}

async function getFromCache(term: string): Promise<DictionaryEntry | null> {
  const [row] = await db
    .select({ payload: dictionaryCache.payload })
    .from(dictionaryCache)
    .where(eq(dictionaryCache.term, term));
  if (!row) return null;
  const parsed = dictionaryEntrySchema.safeParse(row.payload);
  return parsed.success ? parsed.data : null;
}

export interface LookupResult {
  lookupId: number;
  entry: DictionaryEntry;
  inExercises: boolean;
  fromCache: boolean;
}

/** Переводит слово: сначала кэш, потом ИИ. Каждый запрос пишется в lookups. */
export async function lookupTerm(userId: number, query: string, term: string): Promise<LookupResult> {
  let entry = await getFromCache(term);
  const fromCache = entry !== null;

  if (!entry) {
    const { json, provider } = await generateJson(buildPrompt(term));
    entry = sanitize(dictionaryEntrySchema.parse(json));

    const payload = entry;
    // Кэшируем и под запросом пользователя, и под словарной формой («took off» → «take off»).
    for (const key of new Set([term, entry.term])) {
      await db
        .insert(dictionaryCache)
        .values({ term: key, payload, provider })
        .onConflictDoNothing();
    }
  }

  const [lookup] = await db
    .insert(lookups)
    .values({ userId, query, term: entry.is_valid ? entry.term : null })
    .returning({ id: lookups.id });

  const [existing] = await db
    .select({ id: words.id })
    .from(words)
    .where(and(eq(words.userId, userId), eq(words.term, entry.term)));

  return { lookupId: lookup!.id, entry, inExercises: Boolean(existing), fromCache };
}
