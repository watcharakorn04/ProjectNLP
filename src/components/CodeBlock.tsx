import React, { useState } from 'react';
import { Check, Copy, Terminal } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language?: string;
  vendorTag?: string;
  theme?: 'dark' | 'light';
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language = 'bash',
  vendorTag,
  theme = 'dark'
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const lines = code.trim().split('\n');

  // Vendor badge colors
  let badgeColor = 'bg-slate-700 text-slate-300 border-slate-600';
  if (vendorTag?.includes('Cisco') || language.toLowerCase().includes('cisco')) {
    badgeColor = 'bg-sky-500/20 text-sky-400 border-sky-500/40';
  } else if (vendorTag?.includes('Huawei') || language.toLowerCase().includes('huawei')) {
    badgeColor = 'bg-rose-500/20 text-rose-400 border-rose-500/40';
  }

  const isDark = theme === 'dark';

  return (
    <div className={`my-3 overflow-hidden rounded-xl border text-sm font-mono shadow-md ${
      isDark ? 'border-slate-800 bg-slate-950 text-slate-200' : 'border-slate-200 bg-slate-900 text-slate-100'
    }`}>
      {/* Code Header Bar */}
      <div className={`flex items-center justify-between px-3 py-1.5 border-b text-xs ${
        isDark ? 'border-slate-800 bg-slate-900/80 text-slate-400' : 'border-slate-800 bg-slate-800/90 text-slate-300'
      }`}>
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-semibold uppercase tracking-wider text-[11px]">
            {language || 'CLI'}
          </span>
          {vendorTag && (
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${badgeColor}`}>
              {vendorTag}
            </span>
          )}
        </div>

        <button
          onClick={handleCopy}
          type="button"
          aria-label="Copy Code"
          className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-slate-700/60 active:scale-95 text-slate-300 hover:text-white transition-all cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[11px] text-emerald-400 font-medium">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[11px] font-medium">Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code Content */}
      <div className="overflow-x-auto p-3 text-xs leading-relaxed max-h-96">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, idx) => {
              // Simple syntax highlights for CLI commands
              const isComment = line.trim().startsWith('#') || line.trim().startsWith('!');
              const isPrompt = line.includes('>') || line.includes('#') || line.includes(']');
              const isKeyword = line.match(/^\s*(interface|vlan|port|ip|router|ospf|sysname|hostname|switchport|undo|no|display|show)/i);

              return (
                <tr key={idx} className="hover:bg-slate-800/40">
                  <td className="select-none pr-3 text-right text-slate-600 font-mono text-[11px] w-8 align-top">
                    {idx + 1}
                  </td>
                  <td className="whitespace-pre font-mono">
                    {isComment ? (
                      <span className="text-emerald-500/80 italic">{line}</span>
                    ) : isKeyword ? (
                      <span className="text-cyan-300 font-medium">{line}</span>
                    ) : (
                      <span className="text-slate-200">{line}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
