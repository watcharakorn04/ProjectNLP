import mermaid, { type MermaidConfig } from 'mermaid';
import type { AppTheme } from '../types/chat';

/**
 * Single entry point for turning Mermaid source into SVG.
 *
 * - Renders are serialised: `mermaid.initialize` mutates global config, so two viewers
 *   rendering concurrently with different themes would otherwise race.
 * - Diagram source is LLM output, so it is untrusted: `securityLevel: 'strict'` sanitises
 *   label HTML and disables click/callback directives before the SVG reaches the DOM.
 * - Source is parsed before rendering and error SVGs are suppressed, so invalid or
 *   partially streamed diagrams resolve to `{ ok: false }` instead of throwing or
 *   leaving stray nodes in `document.body`.
 */

export type MermaidRenderResult = { ok: true; svg: string } | { ok: false; error: string };

export interface MermaidRenderOptions {
  /**
   * HTML labels (the default) render inside `<foreignObject>`. Set false for plain SVG
   * `<text>` labels, which some browsers need before the SVG can be drawn onto a canvas.
   */
  htmlLabels?: boolean;
}

const MAX_DIAGRAM_CHARS = 20_000;

const FONT = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";

function buildConfig(theme: AppTheme, htmlLabels: boolean): MermaidConfig {
  const isDark = theme === 'dark';
  return {
    startOnLoad: false,
    htmlLabels,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: isDark ? 'dark' : 'neutral',
    fontFamily: FONT,
    fontSize: 15,
    flowchart: {
      useMaxWidth: false,
      htmlLabels,
      curve: 'basis',
      nodeSpacing: 50,
      rankSpacing: 60,
      padding: 18
    },
    themeVariables: isDark
      ? {
          darkMode: true,
          fontSize: '15px',
          fontFamily: FONT,
          background: '#0F172A',
          primaryColor: '#0284c7',
          primaryTextColor: '#f8fafc',
          primaryBorderColor: '#38bdf8',
          lineColor: '#06b6d4',
          secondaryColor: '#1e293b',
          tertiaryColor: '#0f172a',
          mainBkg: '#1e293b',
          nodeBorder: '#38bdf8',
          edgeLabelBackground: '#0f172a'
        }
      : {
          darkMode: false,
          fontSize: '15px',
          fontFamily: FONT,
          background: '#F8FAFC',
          primaryColor: '#1e3a8a',
          primaryTextColor: '#0f172a',
          primaryBorderColor: '#3b82f6',
          lineColor: '#2563eb',
          secondaryColor: '#e2e8f0',
          tertiaryColor: '#f1f5f9',
          mainBkg: '#ffffff',
          nodeBorder: '#2563eb',
          edgeLabelBackground: '#f8fafc'
        },
    themeCSS: `
      .node rect, .node circle, .node ellipse, .node polygon {
        stroke-width: 2px !important;
        rx: 8px !important;
        ry: 8px !important;
      }
      .node .label {
        font-size: 15px !important;
        font-family: 'Plus Jakarta Sans', system-ui, sans-serif !important;
        font-weight: 600 !important;
        line-height: 1.4 !important;
      }
      .node text {
        font-size: 14px !important;
        font-family: 'Plus Jakarta Sans', system-ui, sans-serif !important;
        font-weight: 500 !important;
      }
      .node foreignObject {
        overflow: visible !important;
      }
      .edgeLabel {
        font-size: 13px !important;
        font-family: 'Fira Code', monospace !important;
        font-weight: 600 !important;
        color: ${isDark ? '#38bdf8' : '#1d4ed8'} !important;
        background-color: ${isDark ? '#0f172a' : '#ffffff'} !important;
        padding: 3px 6px !important;
        border-radius: 4px !important;
      }
      .edgePath .path {
        stroke-width: 2.2px !important;
      }
    `
  };
}

/** Lets the SVG scale to its container instead of keeping Mermaid's fixed pixel max-width. */
function makeResponsive(svg: string): string {
  return svg
    .replace(/style="max-width:\s*\d+(\.\d+)?px;?"/gi, 'style="max-width: 100%; height: auto;"')
    .replace(/<svg\s+id="([^"]+)"/i, '<svg id="$1" width="100%"');
}

function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  // Mermaid parse errors are multi-line with a caret diagram; the first line is the useful part.
  return message.split('\n')[0].slice(0, 300) || 'Unknown Mermaid error';
}

let renderQueue: Promise<unknown> = Promise.resolve();
let renderCounter = 0;

async function renderNow(code: string, theme: AppTheme, options: MermaidRenderOptions): Promise<MermaidRenderResult> {
  const source = code.trim();
  if (!source) return { ok: false, error: 'Diagram is empty' };
  if (source.length > MAX_DIAGRAM_CHARS) return { ok: false, error: `Diagram exceeds ${MAX_DIAGRAM_CHARS} characters` };

  const id = `netbot-mermaid-${++renderCounter}`;
  try {
    mermaid.initialize(buildConfig(theme, options.htmlLabels ?? true));
    await mermaid.parse(source);
    const { svg } = await mermaid.render(id, source);
    return { ok: true, svg: makeResponsive(svg) };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  } finally {
    // Mermaid's temporary containers: the svg itself, its enclosing div, and the sandbox iframe.
    for (const tempId of [id, `d${id}`, `i${id}`]) document.getElementById(tempId)?.remove();
  }
}

export function renderMermaid(
  code: string,
  theme: AppTheme,
  options: MermaidRenderOptions = {}
): Promise<MermaidRenderResult> {
  const task = renderQueue.then(() => renderNow(code, theme, options));
  renderQueue = task.catch(() => undefined);
  return task;
}
