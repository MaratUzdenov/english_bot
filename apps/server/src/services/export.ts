import { sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';

type ExportRow = {
  word: string;
  found: boolean;
  translations: string | null;
  transcription: string | null;
  part_of_speech: string | null;
  level: string | null;
  example_en: string | null;
  example_ru: string | null;
  in_exercises: boolean;
  box: number | null;
  status: string | null;
  correct_count: number | null;
  wrong_count: number | null;
  first_lookup: string;
  lookups: number;
};

/** Excel в русской локали ждёт «;» как разделитель. */
const DELIMITER = ';';

function cell(value: string | number | boolean | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function statusLabel(row: ExportRow): string {
  if (!row.found) return 'не найдено';
  if (!row.in_exercises) return 'только перевод';
  if (row.status === 'learned') return 'выучено';
  if (row.box === 0) return 'новое';
  return `изучается (уровень ${row.box})`;
}

/** Все слова, которые пользователь когда-либо присылал, с переводами и прогрессом. CSV в UTF-8 с BOM. */
export async function buildExportCsv(userId: number): Promise<{ csv: Buffer; count: number }> {
  const tz = config.timezone;
  const rows = await db.execute<ExportRow>(sql`
    with asked as (
      select
        coalesce(l.term, lower(trim(l.query))) as word,
        bool_or(l.term is not null) as found,
        min(l.created_at) as first_at,
        count(*)::int as lookups
      from lookups l
      where l.user_id = ${userId}
      group by 1
    )
    select
      a.word,
      a.found,
      (select string_agg(t, '; ') from jsonb_array_elements_text(c.payload -> 'translations') t) as translations,
      c.payload ->> 'transcription' as transcription,
      c.payload ->> 'part_of_speech' as part_of_speech,
      c.payload ->> 'level' as level,
      c.payload -> 'examples' -> 0 ->> 'en' as example_en,
      c.payload -> 'examples' -> 0 ->> 'ru' as example_ru,
      (w.id is not null) as in_exercises,
      w.box,
      w.status,
      w.correct_count,
      w.wrong_count,
      to_char(a.first_at at time zone ${tz}, 'YYYY-MM-DD HH24:MI') as first_lookup,
      a.lookups
    from asked a
    left join dictionary_cache c on c.term = a.word
    left join words w on w.user_id = ${userId} and w.term = a.word
    order by a.first_at
  `);

  const header = [
    'Слово',
    'Перевод',
    'Транскрипция',
    'Часть речи',
    'Уровень CEFR',
    'Пример',
    'Перевод примера',
    'Статус',
    'Верных ответов',
    'Ошибок',
    'Первый запрос',
    'Сколько раз искал',
  ];

  const lines = [header.map(cell).join(DELIMITER)];
  for (const row of rows) {
    lines.push(
      [
        row.word,
        row.translations,
        row.transcription,
        row.part_of_speech,
        row.level,
        row.example_en,
        row.example_ru,
        statusLabel(row),
        row.correct_count,
        row.wrong_count,
        row.first_lookup,
        row.lookups,
      ]
        .map(cell)
        .join(DELIMITER),
    );
  }

  const BOM = '﻿';
  return { csv: Buffer.from(BOM + lines.join('\r\n'), 'utf8'), count: rows.length };
}
