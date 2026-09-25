import React from 'react';
import { GitBranch, Loader2, Maximize2, PanelTop } from 'lucide-react';
import { i18n } from '../utils/i18nData';
import type { SupportedLanguage } from '../types/chat';

interface DiagramCardProps {
  /** Complete diagram source; omit while the block is still streaming. */
  code?: string;
  /** Lines received so far for a diagram that is still streaming. */
  pendingLineCount?: number;
  isActive?: boolean;
  theme: 'dark' | 'light';
  language: SupportedLanguage;
  onShowInCanvas?: (code: string) => void;
  onOpenFullscreen?: (code: string) => void;
}

/**
 * Compact stand-in for a Mermaid block inside a chat bubble. The diagram itself renders
 * once, in the topology canvas; the card links the message to it.
 */
export const DiagramCard: React.FC<DiagramCardProps> = ({
  code,
  pendingLineCount = 0,
  isActive = false,
  theme,
  language,
  onShowInCanvas,
  onOpenFullscreen
}) => {
  const t = i18n[language];
  const isDark = theme === 'dark';
  const isPending = code === undefined;
  const lineCount = code ? code.split('\n').length : 0;

  const buttonClass = `flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium transition-all cursor-pointer active:scale-95 disabled:opacity-60 disabled:cursor-default ${
    isDark
      ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200'
      : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-800'
  }`;

  return (
    <div
      className={`my-3 flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 ${
        isActive
          ? isDark
            ? 'border-cyan-500/50 bg-cyan-500/5'
            : 'border-blue-300 bg-blue-50/60'
          : isDark
          ? 'border-slate-700/80 bg-slate-950/50'
          : 'border-slate-200 bg-slate-50'
      }`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          isDark ? 'bg-slate-800 text-cyan-400' : 'bg-white text-blue-600 border border-slate-200'
        }`}
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
      </div>

      <div className="min-w-0 flex-1">
        <p className={`text-xs font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
          {isPending ? t.diagramCardPending : t.diagramCardTitle}
        </p>
        <p className="text-[11px] text-slate-500 font-mono">
          {isPending
            ? t.canvasReceivingLines.replace('{n}', String(pendingLineCount))
            : `Mermaid.js · ${lineCount} lines`}
        </p>
      </div>

      {!isPending && (
        <div className="flex items-center gap-1.5">
          {onShowInCanvas && (
            <button onClick={() => onShowInCanvas(code)} disabled={isActive} className={buttonClass}>
              <PanelTop className="h-3.5 w-3.5 text-cyan-400" />
              <span>{isActive ? t.diagramCardActive : t.diagramCardShow}</span>
            </button>
          )}
          {onOpenFullscreen && (
            <button onClick={() => onOpenFullscreen(code)} title={t.diagramCardExpand} className={buttonClass}>
              <Maximize2 className="h-3.5 w-3.5 text-sky-400" />
              <span className="hidden sm:inline">{t.diagramCardExpand}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
