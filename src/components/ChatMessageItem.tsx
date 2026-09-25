import React from 'react';
import { ChatMessage } from '../types/chat';
import { CodeBlock } from './CodeBlock';
import { MermaidViewer } from './MermaidViewer';
import { User, Network, ChevronRight } from 'lucide-react';

interface ChatMessageItemProps {
  message: ChatMessage;
  theme?: 'dark' | 'light';
  onOpenFullscreenDiagram?: (code: string) => void;
}

export const ChatMessageItem: React.FC<ChatMessageItemProps> = ({
  message,
  theme = 'dark',
  onOpenFullscreenDiagram
}) => {
  const isUser = message.sender === 'user';
  const isDark = theme === 'dark';

  if (isUser) {
    return (
      <div className="flex justify-end mb-5 w-full">
        <div className="flex items-end gap-2.5 max-w-[85%] md:max-w-[75%] min-w-0">
          <div
            className={`rounded-2xl rounded-br-sm px-4 py-3 shadow-md text-sm leading-relaxed max-w-full overflow-x-auto break-words [overflow-wrap:anywhere] ${
              isDark
                ? 'bg-gradient-to-r from-cyan-600 to-sky-600 text-white font-medium'
                : 'bg-gradient-to-r from-blue-700 to-indigo-700 text-white font-medium shadow-blue-200'
            }`}
          >
            <p className="whitespace-pre-wrap leading-[1.6] break-words [overflow-wrap:anywhere]">
              {message.text}
            </p>
            <div className="mt-1 text-[10px] text-cyan-200/80 text-right font-mono">
              {message.timestamp}
            </div>
          </div>
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${
              isDark ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'bg-blue-100 text-blue-700 border border-blue-200'
            }`}
          >
            <User className="w-4 h-4" />
          </div>
        </div>
      </div>
    );
  }

  // Assistant Message
  return (
    <div className="flex justify-start mb-6 w-full">
      <div className="flex items-start gap-3 max-w-[98%] md:max-w-[92%] w-full min-w-0">
        {/* Assistant Avatar */}
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm mt-0.5 ${
            isDark
              ? 'bg-slate-800 text-cyan-400 border border-cyan-500/30 ring-2 ring-cyan-500/10'
              : 'bg-white text-blue-700 border border-blue-200 shadow-md ring-2 ring-blue-100'
          }`}
        >
          <Network className="w-5 h-5" />
        </div>

        <div className="flex-1 min-w-0 overflow-hidden">
          {/* Assistant Info / Vendor Tag */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={`text-xs font-bold tracking-tight ${isDark ? 'text-slate-200' : 'text-slate-900'}`}>
              NetBot
            </span>
            {message.vendorTag && (
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                  message.vendorTag.includes('Cisco')
                    ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                }`}
              >
                {message.vendorTag}
              </span>
            )}
            <span className="text-[11px] text-slate-500 font-mono ml-auto">
              {message.timestamp}
            </span>
          </div>

          {/* Assistant Message Bubble */}
          <div
            className={`rounded-2xl rounded-tl-sm p-4 md:p-6 shadow-md border text-sm leading-relaxed max-w-full overflow-x-auto break-words [overflow-wrap:anywhere] ${
              isDark
                ? 'bg-slate-900/90 border-slate-800/90 text-slate-200 shadow-slate-950/40'
                : 'bg-white border-slate-200 text-slate-800 shadow-slate-100'
            }`}
          >
            {renderRichMarkdown(message.text, theme)}

            {/* Embedded Mermaid Diagram */}
            {message.diagramCode && (
              <div className="mt-5 max-w-full overflow-hidden">
                <MermaidViewer
                  code={message.diagramCode}
                  theme={theme}
                  onOpenFullscreen={onOpenFullscreenDiagram}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Top-level markdown renderer splitting text and code blocks.
 */
function renderRichMarkdown(content: string, theme: 'dark' | 'light'): React.ReactNode {
  const isDark = theme === 'dark';
  const codeBlockRegex = /```([a-zA-Z0-9_\-]+)?\s*([\s\S]*?)```/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const textBefore = content.substring(lastIndex, match.index);
    if (textBefore.trim()) {
      parts.push(
        <div key={`text_${lastIndex}`} className="space-y-3 max-w-full">
          {renderMarkdownContent(textBefore, isDark)}
        </div>
      );
    }

    const lang = (match[1] || 'bash').toLowerCase();
    const code = match[2].trim();

    if (lang === 'mermaid') {
      parts.push(
        <div key={`mermaid_${match.index}`} className="my-4 max-w-full overflow-hidden">
          <MermaidViewer code={code} theme={theme} />
        </div>
      );
    } else {
      let vendorTag: string | undefined;
      if (lang.includes('cisco') || code.includes('switchport') || code.includes('show run')) {
        vendorTag = 'Cisco IOS';
      } else if (lang.includes('huawei') || code.includes('display current') || code.includes('vlan batch')) {
        vendorTag = 'Huawei VRP';
      }

      parts.push(
        <div key={`code_${match.index}`} className="max-w-full overflow-hidden">
          <CodeBlock
            code={code}
            language={lang}
            vendorTag={vendorTag}
            theme={theme}
          />
        </div>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  const remaining = content.substring(lastIndex);
  if (remaining.trim()) {
    parts.push(
      <div key={`text_remaining`} className="space-y-3 max-w-full">
        {renderMarkdownContent(remaining, isDark)}
      </div>
    );
  }

  return <div className="space-y-3.5 max-w-full">{parts}</div>;
}

/**
 * Line-aware block parser:
 * - Clean vertical headers (never swallowing bullet lines into flex containers)
 * - Clean vertical bullet lists with word-break: break-word and line-height: 1.6
 * - Markdown tables
 * - Paragraphs
 */
function renderMarkdownContent(rawText: string, isDark: boolean): React.ReactNode[] {
  const lines = rawText.split('\n');
  const elements: React.ReactNode[] = [];

  let currentListItems: { text: string; indentLevel: number }[] = [];
  let currentTableLines: string[] = [];
  let currentParagraphLines: string[] = [];

  const flushParagraph = (key: string) => {
    if (currentParagraphLines.length === 0) return;
    const text = currentParagraphLines.join('\n').trim();
    if (text) {
      elements.push(
        <p
          key={key}
          className="leading-[1.6] my-2 text-sm break-words [overflow-wrap:anywhere]"
          style={{ wordBreak: 'break-word', lineHeight: '1.6' }}
        >
          {currentParagraphLines.map((line, lIdx) => (
            <React.Fragment key={lIdx}>
              {parseInlineFormatting(line, isDark)}
              {lIdx < currentParagraphLines.length - 1 && <br />}
            </React.Fragment>
          ))}
        </p>
      );
    }
    currentParagraphLines = [];
  };

  const flushList = (key: string) => {
    if (currentListItems.length === 0) return;
    elements.push(
      <ul
        key={key}
        className="my-3 space-y-2 list-none pl-0 max-w-full"
      >
        {currentListItems.map((item, idx) => {
          const isSubItem = item.indentLevel > 0;
          return (
            <li
              key={idx}
              className={`flex items-start gap-2 max-w-full text-sm leading-[1.6] break-words [overflow-wrap:anywhere] ${
                isSubItem ? 'ml-6 sm:ml-8 mt-1' : ''
              }`}
              style={{ wordBreak: 'break-word', lineHeight: '1.6' }}
            >
              <span
                className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${
                  isSubItem
                    ? isDark
                      ? 'bg-slate-500'
                      : 'bg-slate-400'
                    : isDark
                    ? 'bg-cyan-400 ring-2 ring-cyan-500/20'
                    : 'bg-blue-600 ring-2 ring-blue-500/20'
                }`}
              />
              <div className="flex-1 min-w-0 leading-[1.6] break-words [overflow-wrap:anywhere]">
                {parseInlineFormatting(item.text, isDark)}
              </div>
            </li>
          );
        })}
      </ul>
    );
    currentListItems = [];
  };

  const flushTable = (key: string) => {
    if (currentTableLines.length === 0) return;
    const tableElem = renderTable(currentTableLines, isDark, key);
    if (tableElem) {
      elements.push(tableElem);
    }
    currentTableLines = [];
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // Check if line is a divider
    if (trimmed === '---' || trimmed === '***') {
      flushParagraph(`p_pre_hr_${index}`);
      flushList(`list_pre_hr_${index}`);
      flushTable(`table_pre_hr_${index}`);
      elements.push(
        <hr
          key={`hr_${index}`}
          className={`my-4 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'}`}
        />
      );
      return;
    }

    // Check if line is Table syntax
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      flushParagraph(`p_pre_tbl_${index}`);
      flushList(`list_pre_tbl_${index}`);
      currentTableLines.push(trimmed);
      return;
    } else if (currentTableLines.length > 0) {
      flushTable(`table_${index}`);
    }

    // Check Heading Level 3 (### )
    if (trimmed.startsWith('### ')) {
      flushParagraph(`p_pre_h3_${index}`);
      flushList(`list_pre_h3_${index}`);
      const headingContent = trimmed.replace(/^###\s+/, '');
      elements.push(
        <h3
          key={`h3_${index}`}
          className={`text-base font-bold tracking-tight mt-4 mb-2 pb-1 block border-b ${
            isDark
              ? 'text-cyan-300 border-slate-800/80'
              : 'text-blue-900 border-slate-200'
          }`}
        >
          {parseInlineFormatting(headingContent, isDark)}
        </h3>
      );
      return;
    }

    // Check Heading Level 4 (#### )
    if (trimmed.startsWith('#### ')) {
      flushParagraph(`p_pre_h4_${index}`);
      flushList(`list_pre_h4_${index}`);
      const headingContent = trimmed.replace(/^####\s+/, '');
      elements.push(
        <h4
          key={`h4_${index}`}
          className={`text-sm font-bold tracking-tight mt-3 mb-1.5 block ${
            isDark ? 'text-sky-300' : 'text-blue-800'
          }`}
        >
          {parseInlineFormatting(headingContent, isDark)}
        </h4>
      );
      return;
    }

    // Check Heading Level 2 (## )
    if (trimmed.startsWith('## ')) {
      flushParagraph(`p_pre_h2_${index}`);
      flushList(`list_pre_h2_${index}`);
      const headingContent = trimmed.replace(/^##\s+/, '');
      elements.push(
        <h2
          key={`h2_${index}`}
          className={`text-lg font-extrabold tracking-tight mt-4 mb-2 block ${
            isDark ? 'text-white' : 'text-slate-900'
          }`}
        >
          {parseInlineFormatting(headingContent, isDark)}
        </h2>
      );
      return;
    }

    // Check List Item (- , * , or numbered \d+.)
    const isBullet = /^\s*[-*+]\s+/.test(line);
    const isNumbered = /^\s*\d+\.\s+/.test(line);

    if (isBullet || isNumbered) {
      flushParagraph(`p_pre_list_${index}`);
      // Calculate indentation level
      const leadingSpaces = line.match(/^(\s*)/)?.[1].length || 0;
      const indentLevel = leadingSpaces >= 2 ? 1 : 0;
      const cleanContent = line.replace(/^\s*([-*+]|\d+\.)\s+/, '');

      currentListItems.push({
        text: cleanContent,
        indentLevel
      });
      return;
    }

    // If empty line, flush current blocks
    if (!trimmed) {
      flushParagraph(`p_${index}`);
      flushList(`list_${index}`);
      flushTable(`table_${index}`);
      return;
    }

    // Otherwise, it's a regular paragraph line
    if (currentListItems.length > 0) {
      flushList(`list_pre_p_${index}`);
    }
    currentParagraphLines.push(line);
  });

  // Flush remaining
  flushParagraph('p_final');
  flushList('list_final');
  flushTable('table_final');

  return elements;
}

/**
 * Clean table rendering with horizontal scroll safety.
 */
function renderTable(tableLines: string[], isDark: boolean, key: string) {
  if (tableLines.length < 2) return null;

  const headerLine = tableLines[0];
  const headers = headerLine
    .split('|')
    .map((c) => c.trim())
    .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);

  // Skip separator line (|---|---|)
  const dataRows = tableLines.slice(2).map((line) =>
    line
      .split('|')
      .map((c) => c.trim())
      .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
  );

  return (
    <div
      key={key}
      className="my-3 overflow-x-auto rounded-xl border border-slate-700/60 shadow-sm max-w-full"
    >
      <table className="w-full text-left text-xs border-collapse">
        <thead
          className={
            isDark
              ? 'bg-slate-800/90 text-cyan-300'
              : 'bg-slate-100 text-blue-900 font-semibold'
          }
        >
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                className="p-3 font-bold border-b border-slate-700/60 whitespace-nowrap"
              >
                {parseInlineFormatting(h, isDark)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody
          className={`divide-y ${
            isDark ? 'divide-slate-800 text-slate-300' : 'divide-slate-200 text-slate-700'
          }`}
        >
          {dataRows.map((row, rIdx) => (
            <tr
              key={rIdx}
              className={isDark ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50'}
            >
              {row.map((cell, cIdx) => (
                <td
                  key={cIdx}
                  className="p-3 align-top leading-relaxed break-words"
                  style={{ wordBreak: 'break-word', lineHeight: '1.6' }}
                >
                  {parseInlineFormatting(cell, isDark)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Robust token parser for inline code `...` and bold text **...**
 */
function parseInlineFormatting(text: string, isDark: boolean): React.ReactNode {
  const cleanText = text.replace(/<br\s*\/?>/gi, '\n');
  const tokens = cleanText.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);

  return tokens.map((tok, i) => {
    if (tok.startsWith('`') && tok.endsWith('`')) {
      const code = tok.slice(1, -1);
      return (
        <code
          key={i}
          className={`px-1.5 py-0.5 rounded font-mono text-[11px] font-medium mx-0.5 break-all inline-block align-middle ${
            isDark
              ? 'bg-slate-800 text-cyan-300 border border-slate-700'
              : 'bg-slate-100 text-blue-700 border border-slate-200'
          }`}
        >
          {code}
        </code>
      );
    }
    if (tok.startsWith('**') && tok.endsWith('**')) {
      const bold = tok.slice(2, -2);
      return (
        <strong
          key={i}
          className={`font-semibold ${isDark ? 'text-slate-100' : 'text-slate-900'}`}
        >
          {bold}
        </strong>
      );
    }
    return tok;
  });
}
