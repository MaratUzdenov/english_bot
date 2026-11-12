import ExcelJS from 'exceljs';
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

type StatusKind = 'learned' | 'learning' | 'new' | 'lookup' | 'not_found';

function statusOf(row: ExportRow): { kind: StatusKind; label: string } {
  if (!row.found) return { kind: 'not_found', label: 'Не найдено' };
  if (!row.in_exercises) return { kind: 'lookup', label: 'Только перевод' };
  if (row.status === 'learned') return { kind: 'learned', label: 'Выучено ✓' };
  if (row.box === 0) return { kind: 'new', label: 'Новое' };
  return { kind: 'learning', label: `Изучается (уровень ${row.box} из 5)` };
}

const STATUS_FILL: Record<StatusKind, string> = {
  learned: 'FFC6EFCE', // зелёный
  learning: 'FFFFEB9C', // жёлтый
  new: 'FFDDEBF7', // голубой
  lookup: 'FFEDEDED', // серый
  not_found: 'FFFFC7CE', // красный
};

const COLUMNS: { header: string; key: string; width: number; center?: boolean }[] = [
  { header: 'Слово', key: 'word', width: 22 },
  { header: 'Перевод', key: 'translations', width: 34 },
  { header: 'Транскрипция', key: 'transcription', width: 18 },
  { header: 'Часть речи', key: 'pos', width: 20 },
  { header: 'Уровень', key: 'level', width: 11, center: true },
  { header: 'Пример', key: 'exampleEn', width: 48 },
  { header: 'Перевод примера', key: 'exampleRu', width: 48 },
  { header: 'Статус', key: 'status', width: 26 },
  { header: 'Верно', key: 'correct', width: 10, center: true },
  { header: 'Ошибки', key: 'wrong', width: 10, center: true },
  { header: 'Первый запрос', key: 'firstLookup', width: 18, center: true },
  { header: 'Искал раз', key: 'lookups', width: 12, center: true },
];

const HEADER_FILL = 'FF1F4E78'; // тёмно-синий
const ZEBRA_FILL = 'FFF7F9FC';
const BORDER_COLOR = { argb: 'FFD0D7E2' };

async function loadRows(userId: number): Promise<ExportRow[]> {
  const tz = config.timezone;
  return db.execute<ExportRow>(sql`
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
      to_char(a.first_at at time zone ${tz}, 'DD.MM.YYYY HH24:MI') as first_lookup,
      a.lookups
    from asked a
    left join dictionary_cache c on c.term = a.word
    left join words w on w.user_id = ${userId} and w.term = a.word
    order by a.first_at
  `);
}

/** Все слова, которые пользователь когда-либо присылал, — красивая таблица Excel. */
export async function buildExportXlsx(userId: number): Promise<{ file: Buffer; count: number }> {
  const rows = await loadRows(userId);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'English Words Bot';
  const sheet = workbook.addWorksheet('Мои слова', {
    views: [{ state: 'frozen', ySplit: 1 }], // шапка всегда видна при прокрутке
  });
  // При печати — альбомная ориентация, вся ширина на одной странице.
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  sheet.columns = COLUMNS.map(({ header, key, width }) => ({ header, key, width }));

  // Шапка: белый жирный текст на тёмно-синем фоне.
  const header = sheet.getRow(1);
  header.height = 34;
  header.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FF0F2A44' } } };
  });

  rows.forEach((row, index) => {
    const status = statusOf(row);
    const excelRow = sheet.addRow({
      word: row.word,
      translations: row.translations ?? '',
      transcription: row.transcription ?? '',
      pos: row.part_of_speech ?? '',
      level: row.level ?? '',
      exampleEn: row.example_en ?? '',
      exampleRu: row.example_ru ?? '',
      status: status.label,
      correct: row.correct_count ?? '',
      wrong: row.wrong_count ?? '',
      firstLookup: row.first_lookup,
      lookups: row.lookups,
    });

    excelRow.eachCell({ includeEmpty: true }, (cell, col) => {
      const column = COLUMNS[col - 1];
      cell.font = { name: 'Calibri', size: 12 };
      cell.alignment = {
        vertical: 'middle',
        horizontal: column?.center ? 'center' : 'left',
        indent: column?.center ? 0 : 1,
        wrapText: true,
      };
      cell.border = {
        top: { style: 'thin', color: BORDER_COLOR },
        bottom: { style: 'thin', color: BORDER_COLOR },
        left: { style: 'thin', color: BORDER_COLOR },
        right: { style: 'thin', color: BORDER_COLOR },
      };
      if (index % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_FILL } };
      }
    });

    excelRow.getCell('word').font = { name: 'Calibri', size: 13, bold: true };
    excelRow.getCell('exampleEn').font = { name: 'Calibri', size: 12, italic: true };
    excelRow.getCell('status').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: STATUS_FILL[status.kind] },
    };

    // Высота строки под перенос длинных примеров (~48 символов в строке колонки «Пример»).
    const longest = Math.max(
      (row.example_en ?? '').length,
      (row.example_ru ?? '').length,
      ((row.translations ?? '').length * 48) / 34,
    );
    excelRow.height = Math.max(30, Math.ceil(longest / 45) * 18 + 10);
  });

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };

  const file = Buffer.from(await workbook.xlsx.writeBuffer());
  return { file, count: rows.length };
}
