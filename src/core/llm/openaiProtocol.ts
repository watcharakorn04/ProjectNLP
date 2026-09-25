/**
 * Wire types for Groq's OpenAI-compatible chat completions API, plus a tolerant decoder for
 * one streamed chunk.
 *
 * The prompt builder produces a model-agnostic `ChatRequestBody`; the Groq client adds the model,
 * `stream: true` and any per-model parameters to turn it into an `OpenAiChatRequest`.
 */

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Everything in a chat request except the model-specific fields. */
export interface ChatRequestBody {
  messages: OpenAiMessage[];
  temperature: number;
  max_completion_tokens: number;
}

export interface OpenAiChatRequest extends ChatRequestBody {
  model: string;
  stream: true;
  /** Reasoning models only (e.g. gpt-oss): how long the model thinks before answering. */
  reasoning_effort?: 'low' | 'medium' | 'high';
  /** Reasoning models only: whether the reasoning text is returned alongside the answer. */
  include_reasoning?: boolean;
}

export interface LlmUsage {
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/** Finish reasons the UI reacts to; anything else is reported as an early stop. */
export const FINISH_REASON = {
  stop: 'stop',
  length: 'length',
  contentFilter: 'content_filter'
} as const;

export interface OpenAiStreamChunk {
  /** Text delta carried by this chunk. */
  text: string;
  /** OpenAI finish reason (`stop`, `length`, `content_filter`, …), set on the final chunk. */
  finishReason?: string;
  usage?: LlmUsage;
  /** An error object streamed (or returned) in place of a completion. */
  error?: { message: string; type?: string; code?: string };
}

/** Terminal SSE payload sent after the last chunk. */
export const OPENAI_STREAM_DONE = '[DONE]';

type Json = Record<string, unknown>;

const asObject = (value: unknown): Json | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : undefined;

const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const asNumber = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

function parseUsage(value: unknown): LlmUsage | undefined {
  const usage = asObject(value);
  if (!usage) return undefined;
  return {
    promptTokens: asNumber(usage.prompt_tokens),
    outputTokens: asNumber(usage.completion_tokens),
    totalTokens: asNumber(usage.total_tokens)
  };
}

/** Decodes one streamed `chat.completion.chunk` (or an error body). Tolerates missing fields. */
export function parseOpenAiStreamChunk(payload: unknown): OpenAiStreamChunk {
  const root = asObject(payload) ?? {};

  const error = asObject(root.error);
  if (error) {
    return {
      text: '',
      error: {
        message: asString(error.message) ?? 'Unknown API error',
        type: asString(error.type),
        code: asString(error.code)
      }
    };
  }

  const choice = asObject(Array.isArray(root.choices) ? root.choices[0] : undefined);

  return {
    text: asString(asObject(choice?.delta)?.content) ?? '',
    finishReason: asString(choice?.finish_reason),
    // Groq reports usage under `x_groq` on the final chunk; standard OpenAI uses a top-level `usage`.
    usage: parseUsage(root.usage) ?? parseUsage(asObject(root.x_groq)?.usage)
  };
}
