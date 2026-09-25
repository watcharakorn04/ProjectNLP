/**
 * Splits markdown into prose and fenced code blocks, tolerating a final block
 * that is still open (as happens mid-stream or when a reply is truncated).
 */

export type MarkdownSegment =
  | { type: 'text'; content: string }
  | { type: 'code'; lang: string; code: string; closed: boolean };

const FENCE = '```';

export function splitFencedBlocks(text: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  const pushText = (content: string) => {
    if (content) segments.push({ type: 'text', content });
  };

  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf(FENCE, cursor);
    if (open === -1) {
      pushText(text.slice(cursor));
      break;
    }
    pushText(text.slice(cursor, open));

    const infoStart = open + FENCE.length;
    const lineEnd = text.indexOf('\n', infoStart);
    const sameLineClose = text.indexOf(FENCE, infoStart);

    // ```one-liner``` on a single line
    if (sameLineClose !== -1 && (lineEnd === -1 || sameLineClose < lineEnd)) {
      segments.push({ type: 'code', lang: '', code: text.slice(infoStart, sameLineClose).trim(), closed: true });
      cursor = sameLineClose + FENCE.length;
      continue;
    }

    // Info string still arriving: the language is known but no code yet.
    if (lineEnd === -1) {
      segments.push({ type: 'code', lang: parseLang(text.slice(infoStart)), code: '', closed: false });
      break;
    }

    const lang = parseLang(text.slice(infoStart, lineEnd));
    const close = text.indexOf(FENCE, lineEnd + 1);
    if (close === -1) {
      segments.push({ type: 'code', lang, code: text.slice(lineEnd + 1).trimEnd(), closed: false });
      break;
    }

    segments.push({ type: 'code', lang, code: text.slice(lineEnd + 1, close).trim(), closed: true });
    cursor = close + FENCE.length;
  }

  return segments;
}

function parseLang(info: string): string {
  return (info.trim().split(/\s+/)[0] ?? '').toLowerCase();
}

export interface MermaidExtraction {
  /** The last fully closed ```mermaid block, safe to hand to the renderer. */
  latestComplete: string | null;
  /** Source of a ```mermaid block that has not been closed yet (never rendered). */
  pending: string | null;
}

export function extractMermaid(text: string): MermaidExtraction {
  let latestComplete: string | null = null;
  let pending: string | null = null;

  for (const segment of splitFencedBlocks(text)) {
    if (segment.type !== 'code' || segment.lang !== 'mermaid') continue;
    if (segment.closed) {
      if (segment.code) latestComplete = segment.code;
    } else {
      pending = segment.code;
    }
  }

  return { latestComplete, pending };
}

/** Closes a trailing unterminated fence so text appended afterwards is not swallowed by it. */
export function closeOpenFence(text: string): string {
  const segments = splitFencedBlocks(text);
  const last = segments[segments.length - 1];
  if (last?.type !== 'code' || last.closed) return text;
  return `${text.trimEnd()}\n${FENCE}`;
}

export function hasMermaidFence(text: string): boolean {
  return splitFencedBlocks(text).some((s) => s.type === 'code' && s.lang === 'mermaid');
}
