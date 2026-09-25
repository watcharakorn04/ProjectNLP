/**
 * Pure helpers for exporting a rendered topology diagram. The DOM work (serialising the
 * SVG, rasterising it to PNG, triggering the download) lives in `services/diagramExport.ts`.
 */

export type DiagramExportFormat = 'png' | 'svg';

export interface Size {
  width: number;
  height: number;
}

/** Browsers refuse or silently blank canvases much larger than this on a side. */
export const MAX_CANVAS_SIDE = 8192;

/** Rasterise at 2x so the PNG stays sharp on high-DPI screens and when zoomed. */
export const PNG_SCALE = 2;

/** Used when the SVG carries no usable viewBox or size. */
const FALLBACK_SIZE: Size = { width: 800, height: 600 };

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * `netbot-topology-YYYYMMDD.<ext>`, using the local date so the name matches the
 * user's calendar rather than UTC.
 */
export function buildDiagramFileName(format: DiagramExportFormat, date: Date = new Date()): string {
  const stamp = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  return `netbot-topology-${stamp}.${format}`;
}

/** Parses `min-x min-y width height`; null unless both dimensions are positive numbers. */
export function parseViewBox(viewBox: string | null | undefined): Size | null {
  if (!viewBox) return null;
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [, , width, height] = parts;
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Reads a plain or `px` length; percentages and other units are not absolute sizes. */
function parseLength(value: string | null | undefined): number | null {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)(px)?$/);
  if (!match) return null;
  const n = Number(match[1]);
  return n > 0 ? n : null;
}

/**
 * Intrinsic size of the diagram. The on-screen SVG is made responsive (`width="100%"`),
 * so the viewBox is the reliable source; absolute width/height attributes are the fallback.
 */
export function resolveSvgSize(attrs: { viewBox?: string | null; width?: string | null; height?: string | null }): Size {
  const fromViewBox = parseViewBox(attrs.viewBox);
  if (fromViewBox) return fromViewBox;
  const width = parseLength(attrs.width);
  const height = parseLength(attrs.height);
  return width && height ? { width, height } : FALLBACK_SIZE;
}

/**
 * Canvas size for the PNG: the diagram scaled by `scale`, shrunk proportionally when a
 * side would exceed `maxSide`, and never below 1px.
 */
export function pngCanvasSize(size: Size, scale: number = PNG_SCALE, maxSide: number = MAX_CANVAS_SIDE): Size {
  const factor = Math.min(scale, maxSide / size.width, maxSide / size.height);
  return {
    width: Math.max(1, Math.round(size.width * factor)),
    height: Math.max(1, Math.round(size.height * factor))
  };
}
