import React from 'react';
import { X } from 'lucide-react';
import { MermaidViewer } from './MermaidViewer';

interface TopologyModalProps {
  isOpen: boolean;
  onClose: () => void;
  mermaidCode: string | null;
  theme?: 'dark' | 'light';
  language?: 'EN' | 'TH';
}

export const TopologyModal: React.FC<TopologyModalProps> = ({
  isOpen,
  onClose,
  mermaidCode,
  theme = 'dark',
  language = 'EN'
}) => {
  if (!isOpen || !mermaidCode) return null;

  const isDark = theme === 'dark';
  const isTH = language === 'TH';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
      <div
        className={`flex flex-col w-full max-w-5xl h-[90vh] rounded-2xl border shadow-2xl overflow-hidden ${
          isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900'
        }`}
      >
        <div
          className={`flex items-center justify-between px-6 py-3 border-b ${
            isDark ? 'border-slate-800 bg-slate-950/80' : 'border-slate-200 bg-slate-50'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
            <h3 className="font-bold text-sm">
              {isTH ? 'แผนภาพโครงสร้างเครือข่าย (Fullscreen Topology)' : 'Network Topology Diagram (Fullscreen)'}
            </h3>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 flex flex-col items-center justify-center">
          <div className="w-full h-full max-w-4xl">
            <MermaidViewer code={mermaidCode} theme={theme} language={language} title="Fullscreen View" />
          </div>
        </div>
      </div>
    </div>
  );
};
