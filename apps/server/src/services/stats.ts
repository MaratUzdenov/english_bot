import { sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';

export interface Stats {
  totalWords: number;
  newWords: number;
  learning: number;
  learned: number;
  dueNow: number;
  byBox: number[];
  lookups: number;
  reviewsTotal: number;
  reviewsToday: number;
  accuracy: number | null; // 0..100
  accuracyToday: number | null;
  streak: number;
  trainedToday: boolean;
}

function percent(correct: number, total: number): number | null {
  return total > 0 ? Math.round((correct / total) * 100) : null;
}

/** Серия дней подряд с тренировками: считаем от сегодня (или от вчера, если сегодня ещё не занимались). */
export function computeStreak(days: string[], today: string): number {
  const set = new Set(days);
  const cursor = new Date(`${today}T00:00:00Z`);
  if (!set.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (set.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export async function getStats(userId: number): Promise<Stats> {
  const tz = config.timezone;

  const [w] = await db.execute<{
    total: number;
    new_words: number;
    learning: number;
    learned: number;
    due_now: number;
    by_box: number[];
  }>(sql`
    select
      count(*)::int as total,
      count(*) filter (where box = 0)::int as new_words,
      count(*) filter (where status = 'learning' and box > 0)::int as learning,
      count(*) filter (where status = 'learned')::int as learned,
      count(*) filter (where due_at <= now())::int as due_now,
      array[
        count(*) filter (where box = 0), count(*) filter (where box = 1),
        count(*) filter (where box = 2), count(*) filter (where box = 3),
        count(*) filter (where box = 4), count(*) filter (where box = 5)
      ]::int[] as by_box
    from words where user_id = ${userId}
  `);

  const [r] = await db.execute<{
    total: number;
    correct: number;
    today_total: number;
    today_correct: number;
    lookups: number;
    today: string;
  }>(sql`
    select
      count(*)::int as total,
      count(*) filter (where is_correct)::int as correct,
      count(*) filter (where (created_at at time zone ${tz})::date = (now() at time zone ${tz})::date)::int as today_total,
      count(*) filter (where is_correct and (created_at at time zone ${tz})::date = (now() at time zone ${tz})::date)::int as today_correct,
      (select count(*)::int from lookups where user_id = ${userId}) as lookups,
      to_char((now() at time zone ${tz})::date, 'YYYY-MM-DD') as today
    from reviews where user_id = ${userId}
  `);

  const dayRows = await db.execute<{ day: string }>(sql`
    select distinct to_char((created_at at time zone ${tz})::date, 'YYYY-MM-DD') as day
    from reviews where user_id = ${userId}
    order by day desc limit 400
  `);
  const days = dayRows.map((row) => row.day);
  const today = r?.today ?? new Date().toISOString().slice(0, 10);

  return {
    totalWords: w?.total ?? 0,
    newWords: w?.new_words ?? 0,
    learning: w?.learning ?? 0,
    learned: w?.learned ?? 0,
    dueNow: w?.due_now ?? 0,
    byBox: w?.by_box ?? [0, 0, 0, 0, 0, 0],
    lookups: r?.lookups ?? 0,
    reviewsTotal: r?.total ?? 0,
    reviewsToday: r?.today_total ?? 0,
    accuracy: percent(r?.correct ?? 0, r?.total ?? 0),
    accuracyToday: percent(r?.today_correct ?? 0, r?.today_total ?? 0),
    streak: computeStreak(days, today),
    trainedToday: days.includes(today),
  };
}
