import { Keyboard } from 'grammy';

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
