import React, { useState } from 'react';
import { X, Copy, Check, Search, FileText } from 'lucide-react';
import { UploadedConfigFile } from '../types/network';

interface RawConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  file: UploadedConfigFile | null;
  theme?: 'dark' | 'light';
  language?: 'EN' | 'TH';
}

export const RawConfigModal: React.FC<RawConfigModalProps> = ({
  isOpen,
  onClose,
  file,
  theme = 'dark',
  language = 'EN'
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [copied, setCopied] = useState(false);
  const isDark = theme === 'dark';
  const isTH = language === 'TH';

  if (!isOpen || !file) return null;

  const lines = file.rawContent.split('\n');
  const filteredLines = searchTerm.trim()
    ? lines
        .map((line, idx) => ({ line, originalIdx: idx + 1 }))
        .filter((item) => item.line.toLowerCase().includes(searchTerm.toLowerCase()))
    : lines.map((line, idx) => ({ line, originalIdx: idx + 1 }));

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(file.rawContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className={`flex flex-col w-full max-w-4xl h-[85vh] rounded-2xl border shadow-2xl overflow-hidden transition-all ${
          isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-5 py-3.5 border-b ${
            isDark ? 'border-slate-800 bg-slate-950/80' : 'border-slate-200 bg-slate-50'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${isDark ? 'bg-cyan-500/10 text-cyan-400' : 'bg-blue-50 text-blue-600'}`}>
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm">{file.fileName}</h3>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    file.detectedVendor.includes('Cisco')
                      ? 'bg-sky-500/20 text-sky-400 border-sky-500/40'
                      : file.detectedVendor.includes('Huawei')
                      ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                      : 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                  }`}
                >
                  {file.detectedVendor}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                {file.fileSize} • {lines.length} {isTH ? 'บรรทัด' : 'lines'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                isDark
                  ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200'
                  : 'border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">{isTH ? 'คัดลอกแล้ว' : 'Copied'}</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>{isTH ? 'คัดลอกทั้งหมด' : 'Copy All'}</span>
                </>
              )}
            </button>

            <button
              onClick={onClose}
              className={`p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors cursor-pointer`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className={`px-5 py-2.5 border-b flex items-center gap-2 ${isDark ? 'border-slate-800 bg-slate-950/40' : 'border-slate-200 bg-slate-50/50'}`}>
          <Search className="w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={isTH ? 'ค้นหาคำสั่งใน Config (เช่น vlan, interface, ospf)...' : 'Search in config (e.g., vlan, interface, ospf)...'}
            className={`w-full bg-transparent text-xs font-mono outline-none ${
              isDark ? 'text-slate-100 placeholder:text-slate-500' : 'text-slate-900 placeholder:text-slate-400'
            }`}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="text-[11px] text-slate-400 hover:text-slate-200"
            >
              Clear
            </button>
          )}
        </div>

        {/* Content with line numbers */}
        <div className={`flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed select-text ${isDark ? 'bg-slate-950' : 'bg-slate-900 text-slate-100'}`}>
          <table className="w-full border-collapse">
            <tbody>
              {filteredLines.map((item, idx) => {
                const isComment = item.line.trim().startsWith('#') || item.line.trim().startsWith('!');
                const isKeyword = item.line.match(/^\s*(interface|vlan|port|ip|router|ospf|sysname|hostname|switchport|undo|no|display|show)/i);

                return (
                  <tr key={idx} className="hover:bg-slate-800/60">
                    <td className="select-none pr-4 text-right text-slate-600 font-mono text-[11px] w-12 align-top">
                      {item.originalIdx}
                    </td>
                    <td className="whitespace-pre font-mono">
                      {isComment ? (
                        <span className="text-emerald-500/80 italic">{item.line}</span>
                      ) : isKeyword ? (
                        <span className="text-cyan-300 font-medium">{item.line}</span>
                      ) : (
                        <span className="text-slate-200">{item.line}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
