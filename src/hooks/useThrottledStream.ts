import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Accumulates streamed text in a ref and publishes it to React state at most once per
 * `intervalMs`, so a burst of tiny SSE deltas costs one re-render instead of dozens.
 */
export function useThrottledStream(intervalMs = 60) {
  const fullRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [text, setText] = useState('');

  const cancelTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const append = useCallback(
    (delta: string) => {
      fullRef.current += delta;
      if (timerRef.current !== null) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setText(fullRef.current);
      }, intervalMs);
    },
    [intervalMs]
  );

  /** Publishes everything received so far immediately. */
  const flush = useCallback(() => {
    cancelTimer();
    setText(fullRef.current);
  }, []);

  const reset = useCallback(() => {
    cancelTimer();
    fullRef.current = '';
    setText('');
  }, []);

  /** Full text including deltas not yet published to state. */
  const getFullText = useCallback(() => fullRef.current, []);

  useEffect(() => cancelTimer, []);

  return { text, append, flush, reset, getFullText };
}
