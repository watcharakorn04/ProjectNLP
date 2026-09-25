import { renderMermaid } from './mermaidRenderer';
import { buildDiagramFileName, pngCanvasSize, resolveSvgSize, type Size } from '../core/diagramExport';
import type { AppTheme } from '../types/chat';

/**
 * Downloads a rendered topology diagram as SVG or PNG.
 *
 * - The SVG handed to the viewer is HTML-serialised by Mermaid (`<br>` inside labels) and
 *   sized responsively (`width="100%"`), so it is neither valid XML nor self-sizing. It is
 *   re-parsed and re-serialised with `XMLSerializer` and given an absolute size first.
 * - Mermaid's theme background is page CSS, not part of the SVG, so it is painted in
 *   explicitly; otherwise a dark-theme export shows light text on a transparent background.
 */

export type DiagramExportResult = { ok: true } | { ok: false; error: string };

/** Matches `themeVariables.background` in mermaidRenderer.ts. */
const BACKGROUND: Record<AppTheme, string> = { dark: '#0F172A', light: '#F8FAFC' };

interface StandaloneSvg {
  xml: string;
  size: Size;
}

function toStandaloneSvg(svgMarkup: string, theme: AppTheme): StandaloneSvg | null {
  const svg = new DOMParser().parseFromString(svgMarkup, 'text/html').querySelector('svg');
  if (!svg) return null;
  const size = resolveSvgSize({
    viewBox: svg.getAttribute('viewBox'),
    width: svg.getAttribute('width'),
    height: svg.getAttribute('height')
  });
  svg.setAttribute('width', String(size.width));
  svg.setAttribute('height', String(size.height));
  svg.setAttribute('style', `background-color: ${BACKGROUND[theme]};`);
  return { xml: new XMLSerializer().serializeToString(svg), size };
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The diagram could not be loaded as an image'));
    img.src = src;
  });
}

async function rasterise({ xml, size }: StandaloneSvg, theme: AppTheme): Promise<Blob> {
  // A data: URL (not a blob: URL) keeps the image same-origin for canvas purposes.
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`);
  const { width, height } = pngCanvasSize(size);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable');
  ctx.fillStyle = BACKGROUND[theme];
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  // toBlob throws a SecurityError when the canvas is tainted; the executor turns that into a rejection.
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png');
  });
}

const describeError = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Saves the on-screen diagram as `netbot-topology-YYYYMMDD.svg`. */
export function exportDiagramSvg(svgMarkup: string, theme: AppTheme): DiagramExportResult {
  const standalone = toStandaloneSvg(svgMarkup, theme);
  if (!standalone) return { ok: false, error: 'No SVG element to export' };
  downloadBlob(new Blob([standalone.xml], { type: 'image/svg+xml;charset=utf-8' }), buildDiagramFileName('svg'));
  return { ok: true };
}

/**
 * Saves the diagram as `netbot-topology-YYYYMMDD.png`. Some browsers taint a canvas that has
 * drawn `<foreignObject>` (Mermaid's HTML labels), so a failed first attempt is retried with
 * the diagram re-rendered using plain SVG text labels.
 */
export async function exportDiagramPng(svgMarkup: string, code: string, theme: AppTheme): Promise<DiagramExportResult> {
  const standalone = toStandaloneSvg(svgMarkup, theme);
  if (!standalone) return { ok: false, error: 'No SVG element to export' };

  let blob: Blob;
  try {
    blob = await rasterise(standalone, theme);
  } catch (firstError) {
    const plain = await renderMermaid(code, theme, { htmlLabels: false });
    const fallback = plain.ok ? toStandaloneSvg(plain.svg, theme) : null;
    if (!fallback) return { ok: false, error: plain.ok ? describeError(firstError) : plain.error };
    try {
      blob = await rasterise(fallback, theme);
    } catch (err) {
      return { ok: false, error: describeError(err) };
    }
  }

  downloadBlob(blob, buildDiagramFileName('png'));
  return { ok: true };
}
