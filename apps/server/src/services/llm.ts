import { config } from '../config.js';

export type LlmProvider = 'gemini' | 'openrouter';

export class LlmError extends Error {
  constructor(
    message: string,
    readonly provider: LlmProvider,
    readonly isRateLimit = false,
  ) {
    super(message);
  }
}

/** Все провайдеры недоступны или исчерпали лимит. */
export class LlmUnavailableError extends Error {
  constructor(readonly causes: LlmError[]) {
    super(causes.map((c) => `${c.provider}: ${c.message}`).join('; '));
  }
}

export interface LlmResult {
  json: unknown;
  provider: LlmProvider;
}

const TIMEOUT_MS = 30_000;

/** Убирает комментарии (// и блочные) вне строк и висячие запятые — частые огрехи бесплатных моделей. */
function relaxJson(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else {
      out += ch;
    }
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

/** Достаёт JSON из ответа модели: убирает ```json-обёртку, текст вокруг, комментарии и висячие запятые. */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('В ответе модели нет JSON');
  }
  const candidate = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return JSON.parse(relaxJson(candidate));
  }
}

async function callGemini(prompt: string): Promise<string> {
  if (!config.geminiApiKey) throw new LlmError('GEMINI_API_KEY не задан', 'gemini');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new LlmError(`HTTP ${res.status}: ${body.slice(0, 300)}`, 'gemini', res.status === 429);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new LlmError('Пустой ответ', 'gemini');
  return text;
}

async function callOpenRouter(prompt: string): Promise<string> {
  if (!config.openRouterApiKey) {
    throw new LlmError('OPENROUTER_API_KEY не задан', 'openrouter');
  }
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openRouterApiKey}`,
    },
    body: JSON.stringify({
      model: config.openRouterModel,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.4,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new LlmError(
      `HTTP ${res.status}: ${body.slice(0, 300)}`,
      'openrouter',
      res.status === 429,
    );
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text) throw new LlmError('Пустой ответ', 'openrouter');
  return text;
}

const providers: { name: LlmProvider; call: (prompt: string) => Promise<string> }[] = [
  { name: 'gemini', call: callGemini },
  { name: 'openrouter', call: callOpenRouter },
];

/** Запрашивает JSON у Gemini, при ошибке — у OpenRouter. */
export async function generateJson(prompt: string): Promise<LlmResult> {
  const errors: LlmError[] = [];
  for (const provider of providers) {
    try {
      const text = await provider.call(prompt);
      return { json: extractJson(text), provider: provider.name };
    } catch (error) {
      const llmError =
        error instanceof LlmError
          ? error
          : new LlmError(error instanceof Error ? error.message : String(error), provider.name);
      console.warn(`[llm] ${provider.name} failed: ${llmError.message}`);
      errors.push(llmError);
    }
  }
  throw new LlmUnavailableError(errors);
}
