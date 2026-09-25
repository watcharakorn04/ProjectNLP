import { OPENAI_STREAM_DONE, isGroqKeyFormat, parseOpenAiStreamChunk } from '../core/llm';
import type { ChatRequestBody, OpenAiChatRequest, OpenAiStreamChunk } from '../core/llm';
import {
  LlmError,
  assertNonEmpty,
  fetchWithRetry,
  parseEventJson,
  probeApiKey,
  readSseEvents,
  redactApiKey,
  requestInit,
  toLlmError
} from './llmHttp';
import type { KeyValidationResult, LlmErrorKind, StreamOptions, StreamResult } from './llmHttp';

/**
 * Browser client for Groq's OpenAI-compatible chat completions API, NetBot's only LLM provider.
 * The key (`gsk_…`) travels only in the `Authorization` header; see `llmHttp.ts` for the key-handling rules.
 */

/**
 * Models tried in order until one is available to the key. Groq shut the Llama models down for
 * free and developer tiers on 2026-08-16 (enterprise contracts keep them), so the gpt-oss models
 * Groq recommends as their replacements follow. `llama3-70b-8192` was retired earlier and is omitted.
 */
export const GROQ_MODELS: readonly string[] = [
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b'
];
export const GROQ_MODEL = GROQ_MODELS[0];

const API_BASE = 'https://api.groq.com/openai/v1';
const PROVIDER = 'Groq';

const authHeaders = (apiKey: string) => ({ Authorization: `Bearer ${apiKey.trim()}` });
const readError = (payload: unknown) => parseOpenAiStreamChunk(payload).error;

/** Strips whitespace and wrapping quotes/backticks, so a pasted `"llama-3.1-8b-instant"` is still a valid ID. */
export function normalizeModelId(model: string): string {
  return model.replace(/^[\s'"`]+|[\s'"`]+$/g, '');
}

/** True when the request failed because this model is missing, retired or not enabled for the key. */
export function isModelUnavailable(error: LlmError): boolean {
  if (error.kind !== 'bad-request') return false;
  return (
    error.status === 404 ||
    error.code === 'model_not_found' ||
    error.code === 'model_decommissioned' ||
    /\bmodel\b.*\b(?:does not exist|decommissioned|not found)\b/i.test(error.message)
  );
}

/** Models the current key could not use this session, so later requests skip straight past them. */
let unavailable = { apiKey: '', models: new Set<string>() };

function unavailableModelsFor(apiKey: string): Set<string> {
  if (unavailable.apiKey !== apiKey) unavailable = { apiKey, models: new Set() };
  return unavailable.models;
}

function modelCandidates(apiKey: string, preferred?: string): string[] {
  const chain = [...new Set([preferred ?? '', ...GROQ_MODELS].map(normalizeModelId).filter(Boolean))];
  const skip = unavailableModelsFor(apiKey);
  const usable = chain.filter((model) => !skip.has(model));
  // Access can change (e.g. a plan upgrade); once every model has failed, try the whole chain again.
  return usable.length > 0 ? usable : chain;
}

/** gpt-oss models reason before answering: keep it short so the answer fits the output budget, and don't stream it. */
function reasoningParams(model: string): Pick<OpenAiChatRequest, 'reasoning_effort' | 'include_reasoning'> {
  return model.startsWith('openai/gpt-oss-') ? { reasoning_effort: 'low', include_reasoning: false } : {};
}

/** Maps an error object streamed mid-response (which has no HTTP status) onto an error kind. */
function classifyStreamError(error: NonNullable<OpenAiStreamChunk['error']>): LlmErrorKind {
  const tag = `${error.code ?? ''} ${error.type ?? ''}`;
  if (/invalid_api_key/.test(tag)) return 'invalid-key';
  if (/rate_limit/.test(tag)) return 'rate-limit';
  return 'server';
}

/**
 * Opens the completion stream with the first model in the chain that the key can use.
 * Only "model unavailable" errors move on to the next model; anything else (bad key, rate limit, abort) is thrown.
 */
async function openStream(
  apiKey: string,
  body: ChatRequestBody,
  options: StreamOptions
): Promise<{ res: Response; model: string }> {
  const skip = unavailableModelsFor(apiKey);
  const tried: string[] = [];

  for (const model of modelCandidates(apiKey, options.model)) {
    const request: OpenAiChatRequest = { model, ...body, stream: true, ...reasoningParams(model) };
    try {
      const res = await fetchWithRetry(
        `${API_BASE}/chat/completions`,
        requestInit(authHeaders(apiKey), { body: request, signal: options.signal }),
        { apiKey, providerName: PROVIDER, maxRetries: options.maxRetries, readError }
      );
      skip.delete(model);
      return { res, model };
    } catch (err) {
      const error = toLlmError(err, apiKey, PROVIDER);
      if (!isModelUnavailable(error)) throw error;
      skip.add(model);
      tried.push(model);
      console.warn(`Groq model ${model} is unavailable (${error.message}); trying the next model`);
    }
  }

  throw new LlmError('bad-request', `No Groq model is available to this API key (tried ${tried.join(', ')})`, 404, 'model_not_found');
}

/**
 * Streams a chat completion over Server-Sent Events, calling `onText` with each text delta.
 * Resolves with the full text and the model that answered, or rejects with an `LlmError` (`aborted` when `signal` fires).
 */
export async function streamGroqContent(apiKey: string, body: ChatRequestBody, options: StreamOptions): Promise<StreamResult> {
  // Retries and model fallback happen only before the stream starts, so no partial text is ever emitted twice.
  const { res, model } = await openStream(apiKey, body, options);

  const result: StreamResult = { text: '', model };
  await readSseEvents(
    res,
    (data) => {
      if (data.trim() === OPENAI_STREAM_DONE) return;
      const payload = parseEventJson(data, PROVIDER);
      if (payload === undefined) return;

      const chunk = parseOpenAiStreamChunk(payload);
      if (chunk.error) {
        throw new LlmError(classifyStreamError(chunk.error), redactApiKey(chunk.error.message, apiKey), undefined, chunk.error.code);
      }
      if (chunk.text) {
        result.text += chunk.text;
        options.onText(chunk.text);
      }
      if (chunk.finishReason) result.finishReason = chunk.finishReason;
      if (chunk.usage) result.usage = chunk.usage;
    },
    { apiKey, providerName: PROVIDER }
  );

  return assertNonEmpty(result, PROVIDER);
}

/**
 * Validates with `GET /models`, which needs a valid key but uses no tokens.
 * Keys without the `gsk_` prefix are rejected locally and never sent.
 */
export async function validateGroqKey(apiKey: string, signal?: AbortSignal): Promise<KeyValidationResult> {
  if (!isGroqKeyFormat(apiKey)) return { valid: false, message: 'Groq API keys start with gsk_' };
  return probeApiKey(apiKey, PROVIDER, (key) =>
    fetchWithRetry(`${API_BASE}/models`, requestInit(authHeaders(key), { signal }), {
      apiKey: key,
      providerName: PROVIDER,
      readError
    })
  );
}
