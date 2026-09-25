import { useCallback, useEffect, useRef } from 'react';
import type { ChatRequestBody, LlmUsage } from '../core/llm';
import { streamGroqContent } from '../services/groqService';
import { LlmError, toLlmError } from '../services/llmHttp';
import { useThrottledStream } from './useThrottledStream';

export interface StreamOutcome {
  /** Everything received, including text that arrived before an error or abort. */
  text: string;
  finishReason?: string;
  usage?: LlmUsage;
  /** Groq model that answered (the client picks the first available one in `GROQ_MODELS`). */
  model?: string;
  /** Set when the stream failed (not when the user stopped it). */
  error?: LlmError;
  aborted: boolean;
}

/**
 * Runs one Groq stream at a time. `streamText` is the throttled text for rendering;
 * `start` never rejects — failures and user aborts come back in the `StreamOutcome`.
 */
export function useLlmStream() {
  const { text: streamText, append, flush, reset } = useThrottledStream(60);
  const controllerRef = useRef<AbortController | null>(null);

  const start = useCallback(
    async (apiKey: string, body: ChatRequestBody): Promise<StreamOutcome> => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      reset();

      // Only the newest stream may write to the shared display buffer.
      const isCurrent = () => controllerRef.current === controller;
      let received = '';
      const onText = (delta: string) => {
        received += delta;
        if (isCurrent()) append(delta);
      };

      try {
        const result = await streamGroqContent(apiKey, body, { signal: controller.signal, onText });
        if (isCurrent()) flush();
        return { text: result.text, finishReason: result.finishReason, usage: result.usage, model: result.model, aborted: false };
      } catch (err) {
        if (isCurrent()) flush();
        const error = toLlmError(err, apiKey);
        const aborted = error.kind === 'aborted';
        return { text: received, error: aborted ? undefined : error, aborted };
      } finally {
        if (isCurrent()) controllerRef.current = null;
      }
    },
    [append, flush, reset]
  );

  const abort = useCallback(() => controllerRef.current?.abort(), []);

  // Cancel any in-flight request when the owner unmounts.
  useEffect(() => () => controllerRef.current?.abort(), []);

  return { streamText, start, abort, reset };
}
