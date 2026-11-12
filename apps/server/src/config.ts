import { z } from 'zod';

const envSchema = z.object({
  BOT_TOKEN: z.string().min(20, 'BOT_TOKEN не задан'),
  ALLOWED_USERS: z
    .string()
    .min(1, 'ALLOWED_USERS не задан: укажи Telegram ID через запятую')
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .map(Number),
    )
    .refine((ids) => ids.length > 0 && ids.every(Number.isSafeInteger), {
      message: 'ALLOWED_USERS должен содержать числовые ID через запятую',
    }),
  DATABASE_URL: z.string().url('DATABASE_URL должен быть postgres://...'),
  GEMINI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Ошибка в .env:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = {
  botToken: parsed.data.BOT_TOKEN,
  allowedUsers: new Set(parsed.data.ALLOWED_USERS),
  databaseUrl: parsed.data.DATABASE_URL,
  geminiApiKey: parsed.data.GEMINI_API_KEY,
  openRouterApiKey: parsed.data.OPENROUTER_API_KEY,
} as const;
