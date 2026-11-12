import { LEITNER_INTERVALS_DAYS, type WordStatus } from '@english-bot/shared';

export const MAX_BOX = LEITNER_INTERVALS_DAYS.length - 1; // 5
const LEARNED_RECHECK_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SrsState {
  box: number;
  status: WordStatus;
}

export interface SrsUpdate extends SrsState {
  dueAt: Date;
  promoted: boolean;
}

/**
 * Лейтнер: верно → следующая коробка (интервал 1/3/7/16/35 дней),
 * верно в последней коробке → «выучено» и проверка через 60 дней,
 * ошибка → коробка 1, повтор сразу.
 */
export function applyAnswer(state: SrsState, correct: boolean, now = new Date()): SrsUpdate {
  if (!correct) {
    return { box: 1, status: 'learning', dueAt: now, promoted: false };
  }
  if (state.box >= MAX_BOX) {
    return {
      box: MAX_BOX,
      status: 'learned',
      dueAt: new Date(now.getTime() + LEARNED_RECHECK_DAYS * DAY_MS),
      promoted: state.status !== 'learned',
    };
  }
  const box = state.box + 1;
  const days = LEITNER_INTERVALS_DAYS[box] ?? 1;
  return { box, status: 'learning', dueAt: new Date(now.getTime() + days * DAY_MS), promoted: true };
}

/** «через 3 дня», «завтра», «через 5 часов» */
export function formatWhen(date: Date, now = new Date()): string {
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return 'уже сейчас';
  const hours = Math.round(diffMs / (60 * 60 * 1000));
  if (hours < 1) return 'меньше чем через час';
  if (hours < 24) return `через ${hours} ч`;
  const days = Math.round(diffMs / DAY_MS);
  return days === 1 ? 'завтра' : `через ${days} дн.`;
}
