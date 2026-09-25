/**
 * Wire types for the Gemini `generateContent` / `streamGenerateContent` REST API,
 * plus a tolerant decoder for a single streamed response chunk.
 */

export interface GeminiPart {
  text: string;
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GeminiRequestBody {
  systemInstruction: { parts: GeminiPart[] };
  contents: GeminiContent[];
  generationConfig: {
    temperature: number;
    maxOutputTokens: number;
    thinkingConfig?: { thinkingBudget: number };
  };
}

export interface GeminiUsage {
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface GeminiStreamChunk {
  /** Visible text in this chunk (thought parts are skipped). */
  text: string;
  /** Set on the final chunk, e.g. `STOP`, `MAX_TOKENS`, `SAFETY`. */
  finishReason?: string;
  /** Set when the prompt itself was rejected. */
  blockReason?: string;
  usage?: GeminiUsage;
  /** An error object streamed in place of a candidate. */
  error?: { code?: number; status?: string; message: string };
}

type Json = Record<string, unknown>;

const asObject = (value: unknown): Json | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : undefined;

const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const asNumber = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

export function parseGeminiStreamChunk(payload: unknown): GeminiStreamChunk {
  const root = asObject(payload) ?? {};

  const error = asObject(root.error);
  if (error) {
    return {
      text: '',
      error: {
        code: asNumber(error.code),
        status: asString(error.status),
        message: asString(error.message) ?? 'Unknown Gemini error'
      }
    };
  }

  const candidate = asObject(Array.isArray(root.candidates) ? root.candidates[0] : undefined);
  const parts = asObject(candidate?.content)?.parts;
  const text = Array.isArray(parts)
    ? parts
        .map(asObject)
        .filter((part) => part && part.thought !== true)
        .map((part) => asString(part!.text) ?? '')
        .join('')
    : '';

  const usageMeta = asObject(root.usageMetadata);
  const usage: GeminiUsage | undefined = usageMeta
    ? {
        promptTokens: asNumber(usageMeta.promptTokenCount),
        outputTokens: asNumber(usageMeta.candidatesTokenCount),
        totalTokens: asNumber(usageMeta.totalTokenCount)
      }
    : undefined;

  return {
    text,
    finishReason: asString(candidate?.finishReason),
    blockReason: asString(asObject(root.promptFeedback)?.blockReason),
    usage
  };
}
