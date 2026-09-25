import React, { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, X, XCircle } from 'lucide-react';
import { Toast, ToastTone } from '../hooks/useToasts';

const AUTO_DISMISS_MS: Record<ToastTone, number> = {
  success: 4000,
  warning: 6000,
  error: 7000
};

const TONE_STYLES: Record<ToastTone, { icon: React.ReactNode; dark: string; light: string }> = {
  success: {
    icon: <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />,
    dark: 'bg-slate-900 border-emerald-500/40',
    light: 'bg-white border-emerald-300'
  },
  warning: {
    icon: <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />,
    dark: 'bg-slate-900 border-amber-500/40',
    light: 'bg-white border-amber-300'
  },
  error: {
    icon: <XCircle className="w-4 h-4 text-rose-400 shrink-0" />,
    dark: 'bg-slate-900 border-rose-500/50',
    light: 'bg-white border-rose-300'
  }
};

interface ToastStackProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
  theme?: 'dark' | 'light';
}

const ToastItem: React.FC<{ toast: Toast; onDismiss: (id: number) => void; isDark: boolean }> = ({
  toast,
  onDismiss,
  isDark
}) => {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS[toast.tone]);
    return () => clearTimeout(timer);
  }, [toast.id, toast.tone, onDismiss]);

  const style = TONE_STYLES[toast.tone];

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto flex items-start gap-2.5 w-full p-3 rounded-xl border shadow-xl animate-in slide-in-from-bottom-2 fade-in duration-200 ${
        isDark ? `${style.dark} text-slate-100 shadow-slate-950/60` : `${style.light} text-slate-900`
      }`}
    >
      {style.icon}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold leading-tight break-words">{toast.title}</p>
        {toast.description && (
          <p className="text-[11px] text-slate-400 mt-1 leading-snug break-words">{toast.description}</p>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="p-0.5 rounded text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export const ToastStack: React.FC<ToastStackProps> = ({ toasts, onDismiss, theme = 'dark' }) => (
  <div
    aria-live="polite"
    className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] flex flex-col gap-2 sm:w-80 pointer-events-none"
  >
    {toasts.map((toast) => (
      <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} isDark={theme === 'dark'} />
    ))}
  </div>
);
