import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { ZoomIn, ZoomOut, RotateCcw, Maximize2, Download, Copy, Check, AlertCircle, Move } from 'lucide-react';

interface MermaidViewerProps {
  code: string;
  theme?: 'dark' | 'light';
  title?: string;
  onOpenFullscreen?: (code: string) => void;
}

export const MermaidViewer: React.FC<MermaidViewerProps> = ({
  code,
  theme = 'dark',
  title = 'Network Topology',
  onOpenFullscreen
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [copied, setCopied] = useState<boolean>(false);
  const renderIdRef = useRef<string>(`mermaid_${Math.random().toString(36).substring(2, 9)}`);

  useEffect(() => {
    let isMounted = true;
    const isDark = theme === 'dark';

    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? 'dark' : 'neutral',
        securityLevel: 'loose',
        fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
        fontSize: 15,
        flowchart: {
          useMaxWidth: false,
          htmlLabels: true,
          curve: 'basis',
          nodeSpacing: 50,
          rankSpacing: 60,
          padding: 18
        },
        themeVariables: isDark
          ? {
              darkMode: true,
              fontSize: '15px',
              fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
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
              fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
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
      });

      const uniqueId = `diagram_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      renderIdRef.current = uniqueId;

      mermaid
        .render(uniqueId, code)
        .then(({ svg }) => {
          if (isMounted) {
            // Replace hardcoded pixel max-width so the SVG can scale to fill container and zoom
            const responsiveSvg = svg
              .replace(/style="max-width:\s*\d+(\.\d+)?px;?"/gi, 'style="max-width: 100%; height: auto;"')
              .replace(/<svg\s+id="([^"]+)"/i, '<svg id="$1" width="100%"');

            setSvgContent(responsiveSvg);
            setError(null);
          }
        })
        .catch((err) => {
          if (isMounted) {
            console.warn('Mermaid rendering issue:', err);
            setError('Could not render graph. Displaying syntax definition.');
          }
        });
    } catch (err: unknown) {
      if (isMounted) {
        setError(err instanceof Error ? err.message : 'Render failed');
      }
    }

    return () => {
      isMounted = false;
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

  const handleDownloadSvg = () => {
    if (!svgContent) return;
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `network_topology_${Date.now()}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const isDark = theme === 'dark';

  return (
    <div
      className={`my-4 overflow-hidden rounded-2xl border shadow-lg transition-colors max-w-full ${
        isDark
          ? 'border-cyan-500/20 bg-slate-950/80 backdrop-blur-sm shadow-slate-950/60'
          : 'border-slate-300 bg-white/95 shadow-slate-200'
      }`}
    >
      {/* Topology Toolbar */}
      <div
        className={`flex flex-wrap items-center justify-between border-b px-4 py-2.5 gap-2 ${
          isDark ? 'border-slate-800 bg-slate-900/90 text-slate-200' : 'border-slate-200 bg-slate-100 text-slate-800'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 animate-pulse shrink-0" />
          <span className="text-xs font-bold tracking-wide uppercase">{title}</span>
          <span className="rounded bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-400 border border-cyan-500/20 font-mono">
            Mermaid.js
          </span>
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

          {/* Download SVG */}
          <button
            onClick={handleDownloadSvg}
            title="Download SVG file"
            className={`p-1.5 rounded-lg border transition-all cursor-pointer active:scale-95 ${
              isDark
                ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200'
                : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-800'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
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
        </div>
      </div>

      {/* SVG Canvas Area with dynamic scale and smooth overflow panning */}
      <div
        ref={containerRef}
        className={`relative flex min-h-[300px] max-h-[550px] w-full items-start justify-center overflow-auto p-4 md:p-6 transition-all ${
          isDark ? 'bg-slate-950/70' : 'bg-slate-50'
        }`}
      >
        {error ? (
          <div className="flex flex-col items-center justify-center p-6 text-center text-xs text-amber-400 my-auto">
            <AlertCircle className="w-6 h-6 mb-2 text-amber-400" />
            <p className="font-semibold">{error}</p>
            <pre className="mt-3 max-w-full overflow-x-auto rounded bg-slate-900 p-3 text-left font-mono text-slate-300 text-[11px] border border-slate-800">
              {code}
            </pre>
          </div>
        ) : svgContent ? (
          <div
            style={{
              transform: `scale(${zoomLevel})`,
              transformOrigin: 'top center',
              width: zoomLevel > 1 ? `${Math.round(zoomLevel * 100)}%` : '100%',
              minHeight: `${Math.round(260 * zoomLevel)}px`,
              transition: 'transform 0.15s ease-out, width 0.15s ease-out'
            }}
            className="flex items-center justify-center max-w-full overflow-visible"
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        ) : (
          <div className="flex items-center gap-2 text-xs text-slate-400 my-auto">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
            <span>Rendering Topology Diagram...</span>
          </div>
        )}
      </div>

      {/* Zoom Status Bar */}
      <div className={`flex items-center justify-between px-4 py-1.5 text-[11px] border-t font-mono ${
        isDark ? 'border-slate-800/80 bg-slate-900/50 text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-600'
      }`}>
        <span className="flex items-center gap-1 opacity-75">
          <Move className="w-3 h-3" />
          <span>Scroll to pan diagram when zoomed</span>
        </span>
        <span className={zoomLevel !== 1 ? 'font-bold text-cyan-400' : ''}>
          Scale: {Math.round(zoomLevel * 100)}%
        </span>
      </div>
    </div>
  );
};
