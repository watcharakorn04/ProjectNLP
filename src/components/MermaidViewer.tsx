import React, { useEffect, useState } from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  FileImage,
  FileCode2,
  Loader2,
  Copy,
  Check,
  AlertCircle,
  Move
} from 'lucide-react';
import { renderMermaid } from '../services/mermaidRenderer';
import { exportDiagramPng, exportDiagramSvg, type DiagramExportResult } from '../services/diagramExport';
import { i18n } from '../utils/i18nData';
import type { SupportedLanguage } from '../types/chat';

interface MermaidViewerProps {
  code: string;
  theme?: 'dark' | 'light';
  language?: SupportedLanguage;
  title?: string;
  onOpenFullscreen?: (code: string) => void;
  /** `card`: self-contained bordered card (chat, modal). `panel`: fills its parent (topology canvas). */
  variant?: 'card' | 'panel';
  /** Replaces the default title in the toolbar. */
  toolbarLeading?: React.ReactNode;
  /** Extra controls appended after the built-in toolbar buttons. */
  toolbarTrailing?: React.ReactNode;
}

type RenderState = { status: 'rendering' } | { status: 'ready'; svg: string } | { status: 'error'; error: string };

/** Coalesces rapid code changes (e.g. while a reply is streaming) into one render. */
const RENDER_DEBOUNCE_MS = 120;

/** How long an export failure stays in the status bar. */
const EXPORT_ERROR_MS = 4000;

const MermaidViewerInner: React.FC<MermaidViewerProps> = ({
  code,
  theme = 'dark',
  language = 'EN',
  title = 'Network Topology',
  onOpenFullscreen,
  variant = 'card',
  toolbarLeading,
  toolbarTrailing
}) => {
  const [state, setState] = useState<RenderState>({ status: 'rendering' });
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [copied, setCopied] = useState<boolean>(false);
  const [exportingPng, setExportingPng] = useState<boolean>(false);
  const [exportFailed, setExportFailed] = useState<boolean>(false);
  const t = i18n[language];

  useEffect(() => {
    if (!exportFailed) return;
    const timer = setTimeout(() => setExportFailed(false), EXPORT_ERROR_MS);
    return () => clearTimeout(timer);
  }, [exportFailed]);

  useEffect(() => {
    let cancelled = false;
    setState((prev) => (prev.status === 'ready' ? prev : { status: 'rendering' }));

    const timer = setTimeout(() => {
      renderMermaid(code, theme).then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setState({ status: 'ready', svg: result.svg });
        } else {
          console.warn('Mermaid rendering issue:', result.error);
          setState({ status: 'error', error: result.error });
        }
      });
    }, RENDER_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, theme]);

  const handleZoomIn = () => setZoomLevel((prev) => Math.min(3.0, +(prev + 0.25).toFixed(2)));
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(0.5, +(prev - 0.25).toFixed(2)));
  const handleResetZoom = () => setZoomLevel(1);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const reportExport = (result: DiagramExportResult) => {
    if (result.ok) return;
    console.warn('Diagram export failed:', result.error);
    setExportFailed(true);
  };

  const handleDownloadSvg = () => {
    if (state.status !== 'ready') return;
    reportExport(exportDiagramSvg(state.svg, theme));
  };

  const handleDownloadPng = async () => {
    if (state.status !== 'ready' || exportingPng) return;
    setExportingPng(true);
    try {
      reportExport(await exportDiagramPng(state.svg, code, theme));
    } finally {
      setExportingPng(false);
    }
  };

  const isDark = theme === 'dark';
  const isPanel = variant === 'panel';

  const exportButtonClass = `flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-medium transition-all cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
    isDark
      ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:border-cyan-500/50'
      : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-800 hover:border-blue-400'
  }`;

  return (
    <div
      className={
        isPanel
          ? 'flex flex-col h-full min-h-0 overflow-hidden'
          : `my-4 overflow-hidden rounded-2xl border shadow-lg transition-colors max-w-full ${
              isDark
                ? 'border-cyan-500/20 bg-slate-950/80 backdrop-blur-sm shadow-slate-950/60'
                : 'border-slate-300 bg-white/95 shadow-slate-200'
            }`
      }
    >
      {/* Topology Toolbar */}
      <div
        className={`flex flex-wrap items-center justify-between border-b px-4 py-2 gap-2 shrink-0 ${
          isDark ? 'border-slate-800 bg-slate-900/90 text-slate-200' : 'border-slate-200 bg-slate-100 text-slate-800'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {toolbarLeading ?? (
            <>
              <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 animate-pulse shrink-0" />
              <span className="text-xs font-bold tracking-wide uppercase">{title}</span>
              <span className="rounded bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-400 border border-cyan-500/20 font-mono">
                Mermaid.js
              </span>
            </>
          )}
        </div>

        {/* Toolbar Controls */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Zoom In */}
          <button
            onClick={handleZoomIn}
            title="Zoom In (Enlarge diagram)"
            className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-medium transition-all cursor-pointer active:scale-95 ${
              isDark
                ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:border-cyan-500/50'
                : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-800 hover:border-blue-400'
            }`}
          >
            <ZoomIn className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">Zoom</span>
          </button>

          {/* Zoom Out */}
          <button
            onClick={handleZoomOut}
            title="Zoom Out"
            className={`p-1.5 rounded-lg border transition-all cursor-pointer active:scale-95 ${
              isDark
                ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200'
                : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-800'
            }`}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          {/* Reset Zoom */}
          <button
            onClick={handleResetZoom}
            title="Reset Zoom to 100%"
            className={`p-1.5 rounded-lg border transition-all cursor-pointer active:scale-95 ${
              isDark
                ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200'
                : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-800'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <div className="h-4 w-px bg-slate-700/50 mx-0.5" />

          {/* Fullscreen Modal View */}
          {onOpenFullscreen && (
            <button
              onClick={() => onOpenFullscreen(code)}
              title="Fullscreen View"
              className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-medium transition-all cursor-pointer active:scale-95 ${
                isDark
                  ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:border-cyan-500/50'
                  : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-800 hover:border-blue-400'
              }`}
            >
              <Maximize2 className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden sm:inline">Expand</span>
            </button>
          )}

          {/* Export PNG / SVG */}
          <button
            onClick={handleDownloadPng}
            disabled={state.status !== 'ready' || exportingPng}
            title={t.exportPngTitle}
            aria-label={t.exportPngTitle}
            className={exportButtonClass}
          >
            {exportingPng ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
            ) : (
              <FileImage className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span>PNG</span>
          </button>

          <button
            onClick={handleDownloadSvg}
            disabled={state.status !== 'ready'}
            title={t.exportSvgTitle}
            aria-label={t.exportSvgTitle}
            className={exportButtonClass}
          >
            <FileCode2 className="w-3.5 h-3.5 text-violet-400" />
            <span>SVG</span>
          </button>

          {/* Copy Mermaid Code */}
          <button
            onClick={handleCopyCode}
            title="Copy Mermaid Code"
            className={`p-1.5 rounded-lg border transition-all cursor-pointer active:scale-95 ${
              isDark
                ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200'
                : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-800'
            }`}
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          {toolbarTrailing}
        </div>
      </div>

      {/* SVG Canvas Area with dynamic scale and smooth overflow panning */}
      <div
        className={`relative flex w-full items-start justify-center overflow-auto p-4 md:p-6 transition-all ${
          isPanel ? 'flex-1 min-h-0' : 'min-h-[300px] max-h-[550px]'
        } ${isDark ? 'bg-slate-950/70' : 'bg-slate-50'}`}
      >
        {state.status === 'error' ? (
          <DiagramErrorFallback error={state.error} code={code} />
        ) : state.status === 'ready' ? (
          <div
            style={{
              transform: `scale(${zoomLevel})`,
              transformOrigin: 'top center',
              width: zoomLevel > 1 ? `${Math.round(zoomLevel * 100)}%` : '100%',
              minHeight: isPanel ? undefined : `${Math.round(260 * zoomLevel)}px`,
              transition: 'transform 0.15s ease-out, width 0.15s ease-out'
            }}
            className="flex items-center justify-center max-w-full overflow-visible"
            // Sanitised by Mermaid (securityLevel: 'strict') in services/mermaidRenderer.ts.
            dangerouslySetInnerHTML={{ __html: state.svg }}
          />
        ) : (
          <div className="flex items-center gap-2 text-xs text-slate-400 my-auto">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
            <span>Rendering Topology Diagram...</span>
          </div>
        )}
      </div>

      {/* Zoom Status Bar */}
      <div className={`flex items-center justify-between px-4 py-1.5 text-[11px] border-t font-mono shrink-0 ${
        isDark ? 'border-slate-800/80 bg-slate-900/50 text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-600'
      }`}>
        <span className="flex items-center gap-1 opacity-75">
          <Move className="w-3 h-3" />
          <span>Scroll to pan diagram when zoomed</span>
        </span>
        {exportFailed && (
          <span role="status" className="flex items-center gap-1 text-amber-400">
            <AlertCircle className="w-3 h-3" />
            {t.exportFailed}
          </span>
        )}
        <span className={zoomLevel !== 1 ? 'font-bold text-cyan-400' : ''}>
          Scale: {Math.round(zoomLevel * 100)}%
        </span>
      </div>
    </div>
  );
};

const DiagramErrorFallback: React.FC<{ error: string; code: string }> = ({ error, code }) => (
  <div className="flex flex-col items-center justify-center p-6 text-center text-xs text-amber-400 my-auto max-w-full">
    <AlertCircle className="w-6 h-6 mb-2 text-amber-400" />
    <p className="font-semibold">Could not render graph. Displaying syntax definition.</p>
    <p className="mt-1 font-mono text-[11px] text-amber-300/80 break-words [overflow-wrap:anywhere]">{error}</p>
    <pre className="mt-3 max-w-full overflow-x-auto rounded bg-slate-900 p-3 text-left font-mono text-slate-300 text-[11px] border border-slate-800">
      {code}
    </pre>
  </div>
);

interface BoundaryState {
  error: Error | null;
  failedCode: string | null;
}

/**
 * Last line of defence: anything thrown while rendering the viewer shows the source instead
 * of unmounting the chat. The boundary resets itself when a different diagram arrives.
 */
class MermaidErrorBoundary extends React.Component<{ code: string; children: React.ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null, failedCode: null };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(props: { code: string }, state: BoundaryState): Partial<BoundaryState> | null {
    if (state.error && state.failedCode !== null && props.code !== state.failedCode) {
      return { error: null, failedCode: null };
    }
    return null;
  }

  componentDidCatch(error: Error) {
    console.error('MermaidViewer crashed:', error);
    this.setState({ failedCode: this.props.code });
  }

  render() {
    if (this.state.error) {
      return <DiagramErrorFallback error={this.state.error.message} code={this.props.code} />;
    }
    return this.props.children;
  }
}

export const MermaidViewer: React.FC<MermaidViewerProps> = (props) => (
  <MermaidErrorBoundary code={props.code}>
    <MermaidViewerInner {...props} />
  </MermaidErrorBoundary>
);
