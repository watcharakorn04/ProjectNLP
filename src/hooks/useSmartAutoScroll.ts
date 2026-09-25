import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Keeps a scroll container pinned to the bottom while its content grows (streaming text,
 * diagrams finishing layout), and releases the pin as soon as the user scrolls up.
 *
 * Attach `containerRef` to the scrolling element and `contentRef` to its single inner
 * wrapper; growth is detected with a ResizeObserver on the wrapper.
 */
export function useSmartAutoScroll<C extends HTMLElement = HTMLDivElement, T extends HTMLElement = HTMLDivElement>(
  threshold = 80
) {
  const containerRef = useRef<C>(null);
  const contentRef = useRef<T>(null);
  const pinnedRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const [isPinned, setIsPinnedState] = useState(true);

  const setPinned = useCallback((pinned: boolean) => {
    if (pinnedRef.current === pinned) return;
    pinnedRef.current = pinned;
    setIsPinnedState(pinned);
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const el = containerRef.current;
      if (!el) return;
      setPinned(true);
      el.scrollTo({ top: el.scrollHeight, behavior });
    },
    [setPinned]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    lastScrollTopRef.current = el.scrollTop;

    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const movedUp = el.scrollTop < lastScrollTopRef.current;
      lastScrollTopRef.current = el.scrollTop;

      // At the very bottom (including when shrinking content clamps scrollTop): pinned.
      if (distanceFromBottom <= 2) setPinned(true);
      // Any upward movement is user intent, even a few pixels from a trackpad.
      else if (movedUp) setPinned(false);
      // Scrolling back down close to the bottom re-engages following.
      else if (distanceFromBottom <= threshold) setPinned(true);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [threshold, setPinned]);

  useEffect(() => {
    const el = containerRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return { containerRef, contentRef, isPinned, scrollToBottom };
}
