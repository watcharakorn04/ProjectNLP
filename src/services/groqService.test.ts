/// <reference types="node" />
/**
 * Groq client and key storage against a mocked `fetch` / `sessionStorage`. Run with: npm test
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildChatRequest } from '../core/llm';
import { GROQ_MODEL, GROQ_MODELS, normalizeModelId, streamGroqContent, validateGroqKey } from './groqService';
import { LlmError } from './llmHttp';
import { loadCredentials, saveCredentials } from './apiKeyStorage';

const GROQ_KEY = 'gsk_TestKey0123456789abcdefghij';

const body = buildChatRequest({ language: 'EN', file: null, history: [], userText: 'What is a VLAN?' });

interface Call {
  url: string;
  init: RequestInit;
}

/** A response whose body arrives in the given chunks, to exercise chunk-boundary handling. */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const jsonResponse = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });

const originalFetch = globalThis.fetch;
let calls: Call[] = [];

function mockFetch(respond: (call: Call) => Response) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function rejection(promise: Promise<unknown>): Promise<LlmError> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof LlmError, `expected LlmError, got ${String(err)}`);
    return err;
  }
  assert.fail('expected the promise to reject');
}

describe('streamGroqContent', () => {
  test('streams deltas across arbitrary chunk boundaries and stops at [DONE]', async () => {
    const events =
      'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"index":0,"delta":{"content":"A VLAN "},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"index":0,"delta":{"content":"is a broadcast domain."},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"x_groq":{"usage":{"prompt_tokens":50,"completion_tokens":8,"total_tokens":58}}}\n\n' +
      'data: [DONE]\n\n';
    const chunks: string[] = [];
    for (let i = 0; i < events.length; i += 7) chunks.push(events.slice(i, i + 7));
    mockFetch(() => sseResponse(chunks));

    const deltas: string[] = [];
    const result = await streamGroqContent(GROQ_KEY, body, { onText: (d) => deltas.push(d) });

    assert.equal(result.text, 'A VLAN is a broadcast domain.');
    assert.deepEqual(deltas, ['A VLAN ', 'is a broadcast domain.']);
    assert.equal(result.finishReason, 'stop');
    assert.deepEqual(result.usage, { promptTokens: 50, outputTokens: 8, totalTokens: 58 });
  });

  test('sends the key only in the Authorization header, without credentials or referrer', async () => {
    mockFetch(() => sseResponse(['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n']));
    await streamGroqContent(GROQ_KEY, body, { onText: () => undefined });

    const [{ url, init }] = calls;
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.ok(!url.includes(GROQ_KEY));
    assert.equal((init.headers as Record<string, string>).Authorization, `Bearer ${GROQ_KEY}`);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.referrerPolicy, 'no-referrer');

    const sent = JSON.parse(String(init.body));
    assert.equal(sent.model, GROQ_MODEL);
    assert.equal(sent.stream, true);
    assert.equal(sent.messages[0].role, 'system');
    assert.deepEqual(sent.messages, body.messages);
    assert.equal(sent.temperature, body.temperature);
    assert.equal(sent.max_completion_tokens, body.max_completion_tokens);
  });

  test('classifies a 401 as invalid-key and redacts the key from the message', async () => {
    mockFetch(() => jsonResponse(401, { error: { message: `Invalid API Key ${GROQ_KEY}`, code: 'invalid_api_key' } }));
    const error = await rejection(streamGroqContent(GROQ_KEY, body, { onText: () => undefined }));
    assert.equal(error.kind, 'invalid-key');
    assert.equal(error.status, 401);
    assert.ok(!error.message.includes(GROQ_KEY));
  });

  test('turns an error event mid-stream into an LlmError', async () => {
    mockFetch(() =>
      sseResponse(['data: {"error":{"message":"Rate limit reached","type":"tokens","code":"rate_limit_exceeded"}}\n\n'])
    );
    const error = await rejection(streamGroqContent(GROQ_KEY, body, { onText: () => undefined }));
    assert.equal(error.kind, 'rate-limit');
  });

  test('rejects with empty when the stream carries no text', async () => {
    mockFetch(() => sseResponse(['data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n']));
    const error = await rejection(streamGroqContent(GROQ_KEY, body, { onText: () => undefined }));
    assert.equal(error.kind, 'empty');
  });

  test('rejects as blocked when the content filter stops an empty reply', async () => {
    mockFetch(() => sseResponse(['data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\ndata: [DONE]\n\n']));
    const error = await rejection(streamGroqContent(GROQ_KEY, body, { onText: () => undefined }));
    assert.equal(error.kind, 'blocked');
  });
});

describe('Groq model fallback', () => {
  const ok = () => sseResponse(['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n']);
  const notFound = (model: string) =>
    jsonResponse(404, {
      error: {
        message: `The model \`${model}\` does not exist or you do not have access to it.`,
        type: 'invalid_request_error',
        code: 'model_not_found'
      }
    });
  const sentModel = (call: Call) => JSON.parse(String(call.init.body)).model as string;
  // The unavailable-model memory is per key, so each test uses its own key.
  const key = (n: number) => `gsk_ModelFallbackKey${n}_0123456789abcdef`;

  test('moves down the chain on 404 and reports the model that answered', async () => {
    mockFetch((call) => (sentModel(call).startsWith('llama') ? notFound(sentModel(call)) : ok()));
    const result = await streamGroqContent(key(1), body, { onText: () => undefined });

    assert.deepEqual(calls.map(sentModel), ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'openai/gpt-oss-120b']);
    assert.equal(result.model, 'openai/gpt-oss-120b');
    assert.equal(result.text, 'ok');

    // Later requests with the same key skip the models that already failed.
    calls = [];
    await streamGroqContent(key(1), body, { onText: () => undefined });
    assert.deepEqual(calls.map(sentModel), ['openai/gpt-oss-120b']);
  });

  test('treats a decommissioned model (HTTP 400) as unavailable', async () => {
    mockFetch((call) =>
      calls.length === 1
        ? jsonResponse(400, { error: { message: `The model \`${sentModel(call)}\` has been decommissioned`, code: 'model_decommissioned' } })
        : ok()
    );
    const result = await streamGroqContent(key(2), body, { onText: () => undefined });
    assert.equal(result.model, GROQ_MODELS[1]);
  });

  test('sends reasoning controls to gpt-oss models only', async () => {
    mockFetch((call) => (sentModel(call).startsWith('llama') ? notFound(sentModel(call)) : ok()));
    await streamGroqContent(key(3), body, { onText: () => undefined });
    const [llama, , gptOss] = calls.map((call) => JSON.parse(String(call.init.body)));
    assert.equal(llama.reasoning_effort, undefined);
    assert.equal(llama.include_reasoning, undefined);
    assert.equal(gptOss.reasoning_effort, 'low');
    assert.equal(gptOss.include_reasoning, false);
  });

  test('gives up with a clear error once every model is unavailable, then retries the whole chain', async () => {
    mockFetch((call) => notFound(sentModel(call)));
    const error = await rejection(streamGroqContent(key(4), body, { onText: () => undefined }));
    assert.equal(error.kind, 'bad-request');
    assert.equal(error.code, 'model_not_found');
    assert.match(error.message, /No Groq model is available/);
    assert.deepEqual(calls.map(sentModel), [...GROQ_MODELS]);

    calls = [];
    await rejection(streamGroqContent(key(4), body, { onText: () => undefined }));
    assert.equal(calls.length, GROQ_MODELS.length);
  });

  test('does not switch models on other errors', async () => {
    mockFetch(() => jsonResponse(429, { error: { message: 'Rate limit reached for model `llama-3.1-8b-instant`', code: 'rate_limit_exceeded' } }));
    const error = await rejection(streamGroqContent(key(5), body, { onText: () => undefined, maxRetries: 0 }));
    assert.equal(error.kind, 'rate-limit');
    assert.equal(calls.length, 1);
  });

  test('cleans quotes and whitespace from model IDs', async () => {
    assert.equal(normalizeModelId(`  "llama-3.1-8b-instant" `), 'llama-3.1-8b-instant');
    assert.equal(normalizeModelId("'openai/gpt-oss-20b'"), 'openai/gpt-oss-20b');
    assert.equal(normalizeModelId('`llama-3.3-70b-versatile`\n'), 'llama-3.3-70b-versatile');

    mockFetch(() => ok());
    await streamGroqContent(key(6), body, { onText: () => undefined, model: ' "openai/gpt-oss-20b" ' });
    assert.equal(sentModel(calls[0]), 'openai/gpt-oss-20b');
  });
});

describe('retries', () => {
  test('a persistent 429 gives up after maxRetries and surfaces the rate limit', async () => {
    mockFetch(() => new Response(JSON.stringify({ error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } }), {
      status: 429,
      headers: { 'retry-after': '0.01' }
    }));
    const error = await rejection(streamGroqContent(GROQ_KEY, body, { onText: () => undefined, maxRetries: 1 }));
    assert.equal(error.kind, 'rate-limit');
    assert.equal(calls.length, 2);
  });

  test('a 503 is retried (honouring Retry-After) before the stream starts', async () => {
    let attempt = 0;
    mockFetch(() =>
      attempt++ === 0
        ? new Response(null, { status: 503, headers: { 'retry-after': '0.01' } })
        : sseResponse(['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n'])
    );
    const result = await streamGroqContent(GROQ_KEY, body, { onText: () => undefined, maxRetries: 1 });
    assert.equal(result.text, 'ok');
    assert.equal(calls.length, 2);
  });
});

describe('validateGroqKey', () => {
  test('probes GET /models', async () => {
    mockFetch(() => jsonResponse(200, { data: [] }));
    assert.deepEqual((await validateGroqKey(GROQ_KEY)).valid, true);
    assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/models');
    assert.equal(calls[0].init.method, 'GET');
  });

  test('reports a rejected key without leaking it', async () => {
    mockFetch(() => jsonResponse(401, { error: { message: 'Invalid API Key', code: 'invalid_api_key' } }));
    const result = await validateGroqKey(GROQ_KEY);
    assert.equal(result.valid, false);
    assert.equal(result.message, 'Invalid API Key');
  });

  test('rejects keys without the gsk_ prefix without calling Groq', async () => {
    mockFetch(() => jsonResponse(200, { data: [] }));
    const result = await validateGroqKey('AIzaTestKey0123456789abcdefghij');
    assert.equal(result.valid, false);
    assert.equal(calls.length, 0);
  });
});

describe('apiKeyStorage', () => {
  const store = new Map<string, string>();
  const originalStorage = (globalThis as { sessionStorage?: Storage }).sessionStorage;

  beforeEach(() => {
    store.clear();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key)
    };
  });

  afterEach(() => {
    (globalThis as { sessionStorage?: unknown }).sessionStorage = originalStorage;
  });

  test('stores the key under netbot_groq_key_v1 and clears it when emptied', () => {
    const credentials = { apiKey: GROQ_KEY, status: 'valid' as const, errorMessage: undefined };
    saveCredentials(credentials);
    assert.deepEqual(JSON.parse(store.get('netbot_groq_key_v1')!), { apiKey: GROQ_KEY, status: 'valid' });
    assert.deepEqual(loadCredentials(), credentials);

    saveCredentials({ apiKey: '', status: 'unset' });
    assert.ok(!store.has('netbot_groq_key_v1'));
  });

  test('migrates the Groq key from v2 and drops legacy entries, including any Gemini key', () => {
    store.set('netbot_gemini_credentials_v1', JSON.stringify({ apiKey: 'AIzaLegacyKey', apiKeyStatus: 'valid' }));
    store.set(
      'netbot_llm_credentials_v2',
      JSON.stringify({ gemini: { apiKey: 'AIzaLegacyKey', status: 'valid' }, groq: { apiKey: GROQ_KEY, status: 'valid' } })
    );
    const credentials = loadCredentials();
    assert.deepEqual(credentials, { apiKey: GROQ_KEY, status: 'valid', errorMessage: undefined });

    saveCredentials(credentials);
    assert.deepEqual([...store.keys()], ['netbot_groq_key_v1']);
  });

  test('ignores a legacy Gemini-only key', () => {
    store.set('netbot_gemini_credentials_v1', JSON.stringify({ apiKey: 'AIzaLegacyKey', apiKeyStatus: 'valid' }));
    assert.deepEqual(loadCredentials(), { apiKey: '', status: 'unset' });
  });

  test('a key saved mid-validation comes back unverified', () => {
    saveCredentials({ apiKey: GROQ_KEY, status: 'validating' });
    assert.equal(loadCredentials().status, 'unset');
  });
});
