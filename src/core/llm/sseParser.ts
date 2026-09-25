/**
 * Incremental Server-Sent Events parser.
 *
 * Feed it decoded text chunks exactly as they arrive from a `ReadableStream`
 * (chunk boundaries may fall anywhere, including inside a `\r\n` pair) and it
 * returns the `data` payload of every event completed so far.
 * Only the `data` field is used; `event`, `id`, `retry` and comments are ignored.
 */
export interface SseParser {
  /** Consumes a chunk and returns the data payloads of the events it completed. */
  push(chunk: string): string[];
  /** Call once the stream has ended to dispatch a final event with no trailing blank line. */
  flush(): string[];
}

export function createSseParser(): SseParser {
  let buffer = '';
  let dataLines: string[] = [];

  const dispatch = (out: string[]) => {
    if (dataLines.length > 0) out.push(dataLines.join('\n'));
    dataLines = [];
  };

  const processLine = (line: string, out: string[]) => {
    if (line === '') {
      dispatch(out);
      return;
    }
    if (line.startsWith(':')) return;

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== 'data') return;

    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    dataLines.push(value);
  };

  return {
    push(chunk) {
      const out: string[] = [];
      buffer += chunk;

      // A trailing `\r` may be the first half of a `\r\n` split across chunks; keep it for the next push.
      const holdBack = buffer.endsWith('\r') ? 1 : 0;
      const ready = buffer.slice(0, buffer.length - holdBack);
      const lines = ready.split(/\r\n|\r|\n/);
      buffer = lines.pop()! + buffer.slice(buffer.length - holdBack);

      for (const line of lines) processLine(line, out);
      return out;
    },

    flush() {
      const out: string[] = [];
      const rest = buffer.replace(/\r$/, '');
      buffer = '';
      if (rest) processLine(rest, out);
      dispatch(out);
      return out;
    }
  };
}
