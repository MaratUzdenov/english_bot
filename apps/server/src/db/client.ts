import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { config } from '../config.js';
import * as schema from './schema.js';

const sql = postgres(config.databaseUrl, { max: 10 });

export const db = drizzle(sql, { schema });

/** Применяет SQL-миграции из apps/server/drizzle при старте приложения. */
export async function runMigrations(): Promise<void> {
  const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
  await migrate(db, { migrationsFolder });
}

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
