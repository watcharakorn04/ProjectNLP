import { createSseParser, parseGeminiStreamChunk } from '../core/llm';
import type { GeminiRequestBody, GeminiUsage } from '../core/llm';

/**
 * Browser client for the Gemini REST API.
 *
 * API key handling:
 * - Sent only in the `x-goog-api-key` header, never in the URL (URLs end up in logs, history and proxies).
 * - Requests omit credentials/cookies and the Referer header.
 * - Any error text that is surfaced to the UI is scrubbed of the key.
 */

export const GEMINI_MODEL = 'gemini-3.8-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Transient statuses (overloaded / rate limited) worth retrying before giving up on Gemini. */
const RETRYABLE_STATUSES = new Set([429, 503]);
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 8000;

export type GeminiErrorKind =
  | 'invalid-key'
  | 'rate-limit'
  | 'blocked'
  | 'bad-request'
  | 'server'
  | 'network'
  | 'empty'
  | 'aborted';

export class GeminiError extends Error {
  constructor(
    readonly kind: GeminiErrorKind,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

export interface StreamResult {
  text: string;
  finishReason?: string;
  usage?: GeminiUsage;
}

const GOOGLE_KEY_PATTERN = /AIza[0-9A-Za-z_-]{20,}/g;

export function redactApiKey(message: string, apiKey?: string): string {
  let out = message.replace(GOOGLE_KEY_PATTERN, 'AIza…[redacted]');
  const key = apiKey?.trim();
  if (key && key.length >= 8) out = out.split(key).join('[redacted]');
  return out;
}

function requestInit(apiKey: string, body: unknown, signal?: AbortSignal): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey.trim()
    },
    body: JSON.stringify(body),
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store'
  };
}

function classifyHttpError(status: number, message: string): GeminiErrorKind {
  if (status === 401 || status === 403 || /api[_ ]key/i.test(message)) return 'invalid-key';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'server';
  return 'bad-request';
}

async function errorFromResponse(res: Response, apiKey: string): Promise<GeminiError> {
  const payload: unknown = await res.json().catch(() => null);
  const apiMessage = parseGeminiStreamChunk(payload).error?.message ?? `HTTP ${res.status}`;
  const message = redactApiKey(apiMessage, apiKey);
  return new GeminiError(classifyHttpError(res.status, message), message, res.status);
}

/** Normalises anything thrown by fetch / stream reading into a `GeminiError`. */
export function toGeminiError(err: unknown, apiKey?: string): GeminiError {
  if (err instanceof GeminiError) return err;
  if (err instanceof DOMException && err.name === 'AbortError') return new GeminiError('aborted', 'Request cancelled');
  const message = err instanceof Error ? err.message : String(err);
  return new GeminiError('network', redactApiKey(message || 'Network error contacting Gemini', apiKey));
}

/** Only Gemini 2.5+ models accept `thinkingConfig`; older models reject the request if it is present. */
function supportsThinking(model: string): boolean {
  const version = /^gemini-(\d+(?:\.\d+)?)/.exec(model)?.[1];
  return version !== undefined && Number(version) >= 2.5;
}

function adaptBodyForModel(body: GeminiRequestBody, model: string): GeminiRequestBody {
  if (supportsThinking(model) || !body.generationConfig.thinkingConfig) return body;
  const { thinkingConfig: _unsupported, ...generationConfig } = body.generationConfig;
  return { ...body, generationConfig };
}

/** Exponential backoff with jitter, honouring a numeric `Retry-After` header when the server sends one. */
function retryDelayMs(attempt: number, res: Response): number {
  const retryAfterSeconds = Number(res.headers.get('retry-after'));
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, RETRY_MAX_DELAY_MS);
  }
  const backoff = RETRY_BASE_DELAY_MS * 2 ** attempt;
  return Math.min(backoff + Math.random() * backoff * 0.5, RETRY_MAX_DELAY_MS);
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * POSTs to Gemini, retrying up to `MAX_RETRIES` times on 429/503 before any response body is consumed.
 * Resolves with an OK response, or rejects with a `GeminiError` (`aborted` when the signal fires, even mid-backoff).
 */
async function fetchWithRetry(url: string, init: RequestInit, apiKey: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      if (attempt >= MAX_RETRIES || !RETRYABLE_STATUSES.has(res.status)) throw await errorFromResponse(res, apiKey);

      const delay = retryDelayMs(attempt, res);
      await res.body?.cancel().catch(() => undefined);
      console.warn(`Gemini returned HTTP ${res.status}; retrying in ${Math.round(delay)} ms (${attempt + 1}/${MAX_RETRIES})`);
      await sleep(delay, init.signal);
    } catch (err) {
      throw toGeminiError(err, apiKey);
    }
  }
}

/**
 * Streams a completion over Server-Sent Events (`streamGenerateContent?alt=sse`),
 * calling `onText` with each text delta as it arrives.
 * Resolves with the full text, or rejects with a `GeminiError` (`aborted` when `signal` fires).
 */
export async function streamGeminiContent(
  apiKey: string,
  body: GeminiRequestBody,
  options: { signal?: AbortSignal; onText: (delta: string) => void; model?: string }
): Promise<StreamResult> {
  const { signal, onText, model = GEMINI_MODEL } = options;
  const url = `${API_BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

  // Retries happen only before the stream starts, so no partial text is ever emitted twice.
  const res = await fetchWithRetry(url, requestInit(apiKey, adaptBodyForModel(body, model), signal), apiKey);
  if (!res.body) throw new GeminiError('server', 'Streaming is not supported by this browser');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  const result: StreamResult = { text: '' };
  let finished = false;

  const handleEvent = (data: string) => {
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      console.warn('Skipping malformed Gemini stream event');
      return;
    }

    const chunk = parseGeminiStreamChunk(payload);
    if (chunk.error) {
      const message = redactApiKey(chunk.error.message, apiKey);
      throw new GeminiError(classifyHttpError(chunk.error.code ?? 500, message), message, chunk.error.code);
    }
    if (chunk.blockReason) {
      throw new GeminiError('blocked', `Prompt blocked by Gemini safety filters (${chunk.blockReason})`);
    }
    if (chunk.text) {
      result.text += chunk.text;
      onText(chunk.text);
    }
    if (chunk.finishReason) result.finishReason = chunk.finishReason;
    if (chunk.usage) result.usage = chunk.usage;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true })).forEach(handleEvent);
    }
    parser.push(decoder.decode()).forEach(handleEvent);
    parser.flush().forEach(handleEvent);
    finished = true;
  } catch (err) {
    throw toGeminiError(err, apiKey);
  } finally {
    if (!finished) reader.cancel().catch(() => undefined);
  }

  if (!result.text.trim()) {
    const reason = result.finishReason ? ` (finish reason: ${result.finishReason})` : '';
    throw new GeminiError(result.finishReason === 'SAFETY' ? 'blocked' : 'empty', `Gemini returned an empty response${reason}`);
  }
  return result;
}

export async function validateApiKey(apiKey: string, signal?: AbortSignal): Promise<{ valid: boolean; message: string }> {
  const key = apiKey.trim();
  if (key.length < 10) return { valid: false, message: 'API key is too short or empty' };

  const generationConfig = supportsThinking(GEMINI_MODEL)
    ? { maxOutputTokens: 5, thinkingConfig: { thinkingBudget: 0 } }
    : { maxOutputTokens: 5 };

  try {
    await fetchWithRetry(
      `${API_BASE}/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      requestInit(key, { contents: [{ parts: [{ text: 'Ping' }] }], generationConfig }, signal),
      key
    );
    return { valid: true, message: 'Valid API Key connected successfully!' };
  } catch (err) {
    return { valid: false, message: toGeminiError(err, key).message };
  }
}
