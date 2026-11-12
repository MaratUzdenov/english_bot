import { InlineKeyboard, Keyboard } from 'grammy';
import { WORDS_PAGE_SIZE, type WordsPage } from '../services/words.js';

export const MENU = {
  train: '🏋️ Тренировка',
  progress: '📊 Прогресс',
  words: '📚 Мои слова',
  export: '📤 Экспорт',
} as const;

export const mainMenu = new Keyboard()
  .text(MENU.train)
  .text(MENU.progress)
  .row()
  .text(MENU.words)
  .text(MENU.export)
  .resized()
  .persistent();

/** callback_data ≤ 64 байт, поэтому передаём только id. */
export const CB = {
  add: 'add:', // add:<lookupId>
  words: 'words:', // words:<page>
  del: 'del:', // del:<wordId>:<page>
  noop: 'noop',
} as const;

export function addKeyboard(lookupId: number, inExercises: boolean): InlineKeyboard {
  return inExercises
    ? new InlineKeyboard().text('✅ В упражнениях', CB.noop)
    : new InlineKeyboard().text('➕ В упражнения', `${CB.add}${lookupId}`);
}

export function wordsKeyboard(data: WordsPage): InlineKeyboard {
  const kb = new InlineKeyboard();
  data.items.forEach((item, i) => {
    kb.text(`🗑 ${data.page * WORDS_PAGE_SIZE + i + 1}`, `${CB.del}${item.id}:${data.page}`);
    if (i % 5 === 4) kb.row();
  });
  if (data.totalPages > 1) {
    kb.row();
    if (data.page > 0) kb.text('◀️', `${CB.words}${data.page - 1}`);
    kb.text(`${data.page + 1}/${data.totalPages}`, CB.noop);
    if (data.page < data.totalPages - 1) kb.text('▶️', `${CB.words}${data.page + 1}`);
  }
  return kb;
}
