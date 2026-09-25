import { FINISH_REASON, createSseParser } from '../core/llm';
import type { LlmUsage } from '../core/llm';

/**
 * HTTP plumbing for the Groq client: the error type, API-key redaction, retry-before-stream
 * and SSE reading. The wire format stays in `groqService.ts`.
 *
 * API key handling:
 * - Sent only in a request header, never in the URL (URLs end up in logs, history and proxies).
 * - Requests omit credentials/cookies and the Referer header.
 * - Any error text that is surfaced to the UI is scrubbed of the key.
 */

/** Transient statuses (overloaded / rate limited) worth retrying before falling back to the offline engine. */
const RETRYABLE_STATUSES = new Set([429, 503]);
const DEFAULT_MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 8000;

export type LlmErrorKind =
  | 'invalid-key'
  | 'rate-limit'
  | 'blocked'
  | 'bad-request'
  | 'server'
  | 'network'
  | 'empty'
  | 'aborted';

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly status?: number,
    /** Provider's machine-readable error code, e.g. Groq's `model_not_found`. */
    readonly code?: string
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface StreamResult {
  text: string;
  /** OpenAI finish reason (`stop`, `length`, `content_filter`, …). */
  finishReason?: string;
  usage?: LlmUsage;
  /** Model that produced the reply, when the client picked it from several candidates. */
  model?: string;
}

export interface StreamOptions {
  signal?: AbortSignal;
  onText: (delta: string) => void;
  model?: string;
  /** Retries on 429/503 before the stream starts (default 2). */
  maxRetries?: number;
}

export interface KeyValidationResult {
  valid: boolean;
  message: string;
}

const GROQ_KEY_PATTERN = /gsk_[0-9A-Za-z]{20,}/g;

/** Scrubs the given key, and anything shaped like a Groq key, from text shown to the user. */
export function redactApiKey(message: string, apiKey?: string): string {
  let out = message.replace(GROQ_KEY_PATTERN, 'gsk_…[redacted]');
  const key = apiKey?.trim();
  if (key && key.length >= 8) out = out.split(key).join('[redacted]');
  return out;
}

/** Builds a JSON request (POST when `body` is given, otherwise GET) that carries no cookies or Referer. */
export function requestInit(headers: Record<string, string>, options: { body?: unknown; signal?: AbortSignal }): RequestInit {
  const { body, signal } = options;
  return {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store'
  };
}

export function classifyHttpError(status: number, message: string): LlmErrorKind {
  if (status === 401 || status === 403 || /api[_ ]key/i.test(message)) return 'invalid-key';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'server';
  return 'bad-request';
}

/** Normalises anything thrown by fetch / stream reading into an `LlmError`. */
export function toLlmError(err: unknown, apiKey?: string, providerName = 'Groq'): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof DOMException && err.name === 'AbortError') return new LlmError('aborted', 'Request cancelled');
  const message = err instanceof Error ? err.message : String(err);
  return new LlmError('network', redactApiKey(message || `Network error contacting ${providerName}`, apiKey));
}

interface ProviderContext {
  apiKey: string;
  providerName: string;
}

interface RetryOptions extends ProviderContext {
  maxRetries?: number;
  /** Pulls the message (and code, if any) out of the JSON error body. */
  readError: (payload: unknown) => ProviderErrorBody | undefined;
}

export interface ProviderErrorBody {
  message: string;
  code?: string;
}

async function errorFromResponse(res: Response, options: RetryOptions): Promise<LlmError> {
  const payload: unknown = await res.json().catch(() => null);
  const body = options.readError(payload);
  const message = redactApiKey(body?.message ?? `HTTP ${res.status}`, options.apiKey);
  return new LlmError(classifyHttpError(res.status, message), message, res.status, body?.code);
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
 * Sends the request, retrying up to `maxRetries` times on 429/503 before any response body is consumed.
 * Resolves with an OK response, or rejects with an `LlmError` (`aborted` when the signal fires, even mid-backoff).
 */
export async function fetchWithRetry(url: string, init: RequestInit, options: RetryOptions): Promise<Response> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      if (attempt >= maxRetries || !RETRYABLE_STATUSES.has(res.status)) throw await errorFromResponse(res, options);

      const delay = retryDelayMs(attempt, res);
      await res.body?.cancel().catch(() => undefined);
      console.warn(
        `${options.providerName} returned HTTP ${res.status}; retrying in ${Math.round(delay)} ms (${attempt + 1}/${maxRetries})`
      );
      await sleep(delay, init.signal);
    } catch (err) {
      throw toLlmError(err, options.apiKey, options.providerName);
    }
  }
}

/**
 * Reads a Server-Sent Events body to the end, passing each event's `data` to `onEvent`.
 * Errors thrown by `onEvent` stop reading and propagate as `LlmError`s; the body is cancelled.
 */
export async function readSseEvents(res: Response, onEvent: (data: string) => void, context: ProviderContext): Promise<void> {
  if (!res.body) throw new LlmError('server', 'Streaming is not supported by this browser');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  let finished = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true })).forEach(onEvent);
    }
    parser.push(decoder.decode()).forEach(onEvent);
    parser.flush().forEach(onEvent);
    finished = true;
  } catch (err) {
    throw toLlmError(err, context.apiKey, context.providerName);
  } finally {
    if (!finished) reader.cancel().catch(() => undefined);
  }
}

/** Parses one SSE event payload; malformed events are logged and skipped (returns undefined). */
export function parseEventJson(data: string, providerName: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    console.warn(`Skipping malformed ${providerName} stream event`);
    return undefined;
  }
}

/** Throws the "nothing came back" error for a finished stream with no visible text. */
export function assertNonEmpty(result: StreamResult, providerName: string): StreamResult {
  if (result.text.trim()) return result;
  const reason = result.finishReason ? ` (finish reason: ${result.finishReason})` : '';
  throw new LlmError(
    result.finishReason === FINISH_REASON.contentFilter ? 'blocked' : 'empty',
    `${providerName} returned an empty response${reason}`
  );
}

/** Runs a cheap authenticated request to tell whether a key works. Never rejects. */
export async function probeApiKey(
  apiKey: string,
  providerName: string,
  probe: (key: string) => Promise<unknown>
): Promise<KeyValidationResult> {
  const key = apiKey.trim();
  if (key.length < 10) return { valid: false, message: 'API key is too short or empty' };
  try {
    await probe(key);
    return { valid: true, message: 'Valid API Key connected successfully!' };
  } catch (err) {
    return { valid: false, message: toLlmError(err, key, providerName).message };
  }
}
