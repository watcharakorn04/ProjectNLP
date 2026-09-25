import React from 'react';
import { ChevronDown, ChevronUp, GitBranch, Loader2, Network } from 'lucide-react';
import { MermaidViewer } from './MermaidViewer';
import { i18n } from '../utils/i18nData';
import type { AppTheme, SupportedLanguage } from '../types/chat';

/**
 * - `idle`: showing the active diagram (or the empty state).
 * - `drawing`: a ```mermaid block is streaming in; the previous diagram stays visible.
 * - `live`: the streaming reply has produced a complete diagram, rendered while text continues.
 */
export type CanvasStatus = 'idle' | 'drawing' | 'live';

interface TopologyCanvasProps {
  code: string | null;
  status: CanvasStatus;
  /** Lines received so far for a diagram that is still streaming. */
  pendingLineCount: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenFullscreen: (code: string) => void;
  onGenerate: () => void;
  canGenerate: boolean;
  theme: AppTheme;
  language: SupportedLanguage;
}

export const TopologyCanvas: React.FC<TopologyCanvasProps> = ({
  code,
  status,
  pendingLineCount,
  collapsed,
  onToggleCollapsed,
  onOpenFullscreen,
  onGenerate,
  canGenerate,
  theme,
  language
}) => {
  const t = i18n[language];
  const isDark = theme === 'dark';

  const statusPill =
    status === 'drawing' ? (
      <span className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t.canvasStatusDrawing}
      </span>
    ) : status === 'live' ? (
      <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
        {t.canvasStatusLive}
      </span>
    ) : code ? (
      <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-400">
        {t.canvasStatusReady}
      </span>
    ) : null;

  const leading = (
    <>
      <GitBranch className={`h-4 w-4 shrink-0 ${isDark ? 'text-cyan-400' : 'text-blue-600'}`} />
      <span className="text-xs font-bold tracking-wide uppercase truncate">{t.canvasTitle}</span>
      {statusPill}
    </>
  );

  const collapseButton = (
    <button
      onClick={onToggleCollapsed}
      title={collapsed ? t.canvasShow : t.canvasHide}
      aria-expanded={!collapsed}
      className={`p-1.5 rounded-lg border transition-all cursor-pointer active:scale-95 ${
        isDark
          ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200'
          : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-800'
      }`}
    >
      {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
    </button>
  );

  const plainHeader = (
    <div
      className={`flex items-center justify-between gap-2 px-4 py-2 shrink-0 ${
        collapsed ? '' : 'border-b'
      } ${isDark ? 'border-slate-800 bg-slate-900/90 text-slate-200' : 'border-slate-200 bg-slate-100 text-slate-800'}`}
    >
      <div className="flex items-center gap-2 min-w-0">{leading}</div>
      {collapseButton}
    </div>
  );

  return (
    <section
      aria-label={t.canvasTitle}
      className={`shrink-0 border-b ${isDark ? 'border-slate-800 bg-slate-950/60' : 'border-slate-200 bg-white'}`}
    >
      {collapsed ? (
        plainHeader
      ) : (
        <div className="flex flex-col h-[36vh] min-h-[240px] max-h-[440px]">
          {code ? (
            <MermaidViewer
              code={code}
              theme={theme}
              variant="panel"
              onOpenFullscreen={onOpenFullscreen}
              toolbarLeading={leading}
              toolbarTrailing={collapseButton}
            />
          ) : (
            <>
              {plainHeader}
              <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3 p-6 text-center">
                {status === 'drawing' ? (
                  <>
                    <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
                    <p className="text-xs text-slate-400 font-mono">
                      {t.canvasReceivingLines.replace('{n}', String(pendingLineCount))}
                    </p>
                  </>
                ) : (
                  <>
                    <div
                      className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                        isDark ? 'bg-slate-800 text-cyan-400' : 'bg-blue-50 text-blue-600'
                      }`}
                    >
                      <Network className="h-5 w-5" />
                    </div>
                    <div>
                      <p className={`text-sm font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                        {t.canvasEmptyTitle}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 max-w-sm">{t.canvasEmptyDesc}</p>
                    </div>
                    <button
                      onClick={onGenerate}
                      disabled={!canGenerate}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
                        isDark
                          ? 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                          : 'bg-blue-600 text-white hover:bg-blue-500'
                      }`}
                    >
                      <GitBranch className="h-3.5 w-3.5" />
                      {t.topologyButton}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
};
