import { existsSync, readFileSync } from 'node:fs';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { InputFile } from 'grammy';
import { z } from 'zod';
import { bot } from '../bot/index.js';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { checkInput, lookupTerm } from '../services/dictionary.js';
import type { Task } from '../services/exercises.js';
import { buildExportXlsx } from '../services/export.js';
import { LlmUnavailableError } from '../services/llm.js';
import { getStats } from '../services/stats.js';
import {
  type AnswerResult,
  answerCard,
  answerChoice,
  answerText,
  nextTask,
  skipTask,
  startTraining,
  stopTraining,
} from '../services/training.js';
import { addWordFromLookup, deleteWord, getWordsPage } from '../services/words.js';
import { type TelegramUser, verifyInitData } from './auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    tgUser: TelegramUser;
  }
}

/** Задание без правильного ответа: его клиент получает только после ответа. */
export function publicTask(task: Task) {
  return {
    seq: task.seq,
    type: task.type,
    term: task.term,
    prompt: task.prompt,
    options: task.options ?? null,
    retry: task.retry,
    // Для карточки перевод показывается по кнопке «Показать», до ответа.
    reveal: task.type === 'card' ? task.reveal : null,
  };
}

function publicResult(result: AnswerResult) {
  return {
    correct: result.correct,
    answer: result.task.answer,
    correctIndex: result.task.correctIndex ?? null,
    note: result.note ?? null,
    reveal: result.task.reveal,
  };
}

const answerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('choice'), seq: z.number().int(), index: z.number().int().min(0) }),
  z.object({ kind: z.literal('card'), seq: z.number().int(), remembered: z.boolean() }),
  z.object({ kind: z.literal('text'), seq: z.number().int(), text: z.string().min(1).max(300) }),
  z.object({ kind: z.literal('skip'), seq: z.number().int() }),
]);

async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization ?? '';
  const initData = header.startsWith('tma ') ? header.slice(4) : '';
  const user = initData ? verifyInitData(initData, config.botToken) : null;
  if (!user) {
    await reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  if (!config.allowedUsers.has(user.id)) {
    await reply.code(403).send({ error: 'closed_beta' });
    return;
  }
  request.tgUser = user;
  await db
    .insert(users)
    .values({ id: user.id, username: user.username, firstName: user.first_name })
    .onConflictDoUpdate({ target: users.id, set: { username: user.username, firstName: user.first_name } });
}

function loadTls(): { key: Buffer; cert: Buffer } | null {
  const { tlsCertPath, tlsKeyPath } = config;
  if (!tlsCertPath || !tlsKeyPath) return null;
  if (!existsSync(tlsCertPath) || !existsSync(tlsKeyPath)) {
    console.warn(`⚠️ Сертификат не найден (${tlsCertPath}) — API запускается без HTTPS`);
    return null;
  }
  return { cert: readFileSync(tlsCertPath), key: readFileSync(tlsKeyPath) };
}

let usesHttps = false;

export async function buildApi(): Promise<FastifyInstance> {
  const tls = loadTls();
  usesHttps = tls !== null;
  const app = (tls ? Fastify({ https: tls }) : Fastify()) as unknown as FastifyInstance;

  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(async (api) => {
    api.addHook('preHandler', authenticate);

    api.get('/api/me', async (req) => ({ id: req.tgUser.id, firstName: req.tgUser.first_name ?? null }));

    api.get('/api/stats', async (req) => getStats(req.tgUser.id));

    // ---- слова ----
    api.get('/api/words', async (req) => {
      const page = Number((req.query as { page?: string }).page ?? 0);
      return getWordsPage(req.tgUser.id, Number.isFinite(page) ? page : 0);
    });

    api.delete('/api/words/:id', async (req, reply) => {
      const deleted = await deleteWord(req.tgUser.id, Number((req.params as { id: string }).id));
      return deleted ? { ok: true } : reply.code(404).send({ error: 'not_found' });
    });

    api.post('/api/lookup', async (req, reply) => {
      const body = z.object({ text: z.string().min(1).max(200) }).safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'bad_request' });
      const check = checkInput(body.data.text);
      if (!check.ok) return reply.code(400).send({ error: check.reason });
      try {
        const result = await lookupTerm(req.tgUser.id, body.data.text, check.term);
        return { lookupId: result.lookupId, inExercises: result.inExercises, entry: result.entry };
      } catch (error) {
        if (error instanceof LlmUnavailableError) {
          const limit = error.causes.some((c) => c.isRateLimit);
          return reply.code(503).send({ error: limit ? 'llm_limit' : 'llm_unavailable' });
        }
        throw error;
      }
    });

    api.post('/api/words', async (req, reply) => {
      const body = z.object({ lookupId: z.number().int() }).safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'bad_request' });
      return { result: await addWordFromLookup(req.tgUser.id, body.data.lookupId) };
    });

    // ---- тренировка ----
    api.post('/api/training/start', async (req) => {
      const result = await startTraining(req.tgUser.id);
      if (result.kind === 'task') return { kind: 'task', total: result.total, task: publicTask(result.task) };
      if (result.kind === 'nothing_due') return { kind: 'nothing_due', nextDue: result.nextDue };
      return { kind: 'no_words' };
    });

    api.get('/api/training/current', async (req) => {
      const result = await nextTask(req.tgUser.id);
      if (!result) return { kind: 'none' };
      if (result.kind === 'done') return { kind: 'done', summary: result.summary };
      return { kind: 'task', task: publicTask(result.task) };
    });

    api.post('/api/training/answer', async (req, reply) => {
      const body = answerSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'bad_request' });
      const userId = req.tgUser.id;
      const a = body.data;
      let result: AnswerResult | null = null;
      if (a.kind === 'choice') result = await answerChoice(userId, a.seq, a.index);
      else if (a.kind === 'card') result = await answerCard(userId, a.seq, a.remembered);
      else if (a.kind === 'skip') result = await skipTask(userId, a.seq);
      else result = await answerText(userId, a.text, a.seq);
      return result ? publicResult(result) : reply.code(409).send({ error: 'stale_task' });
    });

    api.post('/api/training/stop', async (req) => ({ summary: await stopTraining(req.tgUser.id) }));

    // ---- экспорт: файл присылает бот в личку (скачивание внутри Mini App неудобно) ----
    api.post('/api/export', async (req) => {
      const { file, count } = await buildExportXlsx(req.tgUser.id);
      if (count === 0) return { sent: false, count };
      const date = new Date().toISOString().slice(0, 10);
      await bot.api.sendDocument(req.tgUser.id, new InputFile(file, `english-words-${date}.xlsx`), {
        caption: `📤 Все слова, которые ты присылал(а): ${count}.`,
      });
      return { sent: true, count };
    });
  });

  app.setErrorHandler(async (error, _req, reply) => {
    console.error('[api]', error);
    await reply.code(500).send({ error: 'internal' });
  });

  return app;
}

export async function startApi(): Promise<FastifyInstance> {
  const app = await buildApi();
  await app.listen({ port: config.apiPort, host: '0.0.0.0' });
  const scheme = usesHttps ? 'https' : 'http';
  console.log(`🌐 API: ${scheme}://0.0.0.0:${config.apiPort}`);
  return app;
}
