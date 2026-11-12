import type { DictionaryEntry } from '@english-bot/shared';
import { WORDS_PAGE_SIZE, type WordsPage } from '../services/words.js';

import { escapeHtml } from '../utils/html.js';

export { escapeHtml };

/** Выделяет форму слова жирным внутри примера. */
function highlight(sentence: string, form: string): string {
  const index = sentence.indexOf(form);
  if (index === -1) return escapeHtml(sentence);
  return (
    escapeHtml(sentence.slice(0, index)) +
    `<b>${escapeHtml(form)}</b>` +
    escapeHtml(sentence.slice(index + form.length))
  );
}

const SHOWN_EXAMPLES = 2;

/** Карточка слова для ответа в Telegram (parse_mode: HTML). */
export function formatEntry(entry: DictionaryEntry): string {
  const meta = [entry.transcription, entry.part_of_speech, entry.level]
    .filter(Boolean)
    .map((part) => escapeHtml(part!))
    .join(' · ');

  const lines = [`<b>${escapeHtml(entry.term)}</b>`];
  if (meta) lines.push(`<i>${meta}</i>`);
  lines.push('', `🇷🇺 ${escapeHtml(entry.translations.join('; '))}`);

  const examples = entry.examples.slice(0, SHOWN_EXAMPLES);
  if (examples.length > 0) {
    lines.push('', '<b>Примеры</b>');
    for (const ex of examples) {
      lines.push(`• ${highlight(ex.en, ex.form)}`, `   <i>${escapeHtml(ex.ru)}</i>`);
    }
  }

  if (entry.collocations.length > 0) {
    lines.push('', `<b>Сочетания:</b> ${escapeHtml(entry.collocations.join(', '))}`);
  }
  return lines.join('\n');
}

const BOX_ICONS = ['⚪', '🔴', '🟠', '🟡', '🟢', '🔵'];

export function formatWordsPage(data: WordsPage): string {
  if (data.total === 0) {
    return 'Пока пусто. Пришли мне слово и нажми «➕ В упражнения».';
  }
  const start = data.page * WORDS_PAGE_SIZE;
  const lines = data.items.map((item, i) => {
    const icon = BOX_ICONS[item.box] ?? '⚪';
    const translation = item.translation ? ` — ${escapeHtml(item.translation)}` : '';
    return `${start + i + 1}. ${icon} <b>${escapeHtml(item.term)}</b>${translation}`;
  });
  return [
    `📚 <b>Мои слова</b> (${data.total})`,
    '',
    ...lines,
    '',
    '<i>⚪ новое → 🔴🟠🟡🟢 → 🔵 почти выучено</i>',
  ].join('\n');
}
