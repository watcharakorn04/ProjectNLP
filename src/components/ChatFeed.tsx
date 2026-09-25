import React, { useRef, useEffect, useState } from 'react';
import {
  Send,
  Sparkles,
  Menu,
  Download,
  Trash2,
  Network,
  Shield,
  Layers,
  Terminal,
  FileCode2,
  Square,
  ArrowDown
} from 'lucide-react';
import { ChatMessage, AppSettings, PendingReply } from '../types/chat';
import { UploadedConfigFile, VendorType } from '../types/network';
import { ChatMessageItem } from './ChatMessageItem';
import { i18n } from '../utils/i18nData';
import { hasMermaidFence, hasVerifiedKey } from '../core/llm';
import { useSmartAutoScroll } from '../hooks/useSmartAutoScroll';

interface ChatFeedProps {
  messages: ChatMessage[];
  settings: AppSettings;
  uploadedFile: UploadedConfigFile | null;
  isGenerating: boolean;
  /** Assistant reply being streamed; rendered after `messages`. */
  pendingReply: PendingReply | null;
  /** Rendered between the header and the message list (the topology canvas). */
  topPanel?: React.ReactNode;
  activeDiagramCode: string | null;
  onSendMessage: (text: string) => void;
  onQuickPrompt: (promptText: string) => void;
  onStopGenerating: () => void;
  onResetChat: () => void;
  onOpenMobileSidebar: () => void;
  onOpenFullscreenDiagram: (code: string) => void;
  onShowDiagram: (code: string) => void;
}

export const ChatFeed: React.FC<ChatFeedProps> = ({
  messages,
  settings,
  uploadedFile,
  isGenerating,
  pendingReply,
  topPanel,
  activeDiagramCode,
  onSendMessage,
  onQuickPrompt,
  onStopGenerating,
  onResetChat,
  onOpenMobileSidebar,
  onOpenFullscreenDiagram,
  onShowDiagram
}) => {
  const [inputText, setInputText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { containerRef, contentRef, isPinned, scrollToBottom } = useSmartAutoScroll(80);

  const t = i18n[settings.currentLanguage];
  const isDark = settings.theme === 'dark';
  const isOnline = hasVerifiedKey(settings.credentials);
  const isTH = settings.currentLanguage === 'TH';

  // Content growth (streamed text, new replies) is followed by the ResizeObserver while pinned.
  // Sending a message is explicit intent to follow the conversation, so it re-pins.
  const lastMessage = messages[messages.length - 1];
  useEffect(() => {
    if (lastMessage?.sender === 'user') scrollToBottom('smooth');
  }, [lastMessage, scrollToBottom]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [inputText]);

  const handleSend = () => {
    if (!inputText.trim() || isGenerating) return;
    const textToSend = inputText;
    setInputText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    onSendMessage(textToSend);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleExportChat = () => {
    const exportContent = messages
      .map(
        (m) =>
          `### [${m.timestamp}] ${m.sender === 'user' ? 'USER' : 'ASSISTANT'}\n\n${m.text}\n\n${
            m.diagramCode && !hasMermaidFence(m.text) ? `\`\`\`mermaid\n${m.diagramCode}\n\`\`\`\n\n` : ''
          }`
      )
      .join('\n---\n\n');

    const blob = new Blob([exportContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `netbot_chat_${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Vendor Context
  const vendorContext: VendorType | null = uploadedFile ? uploadedFile.detectedVendor : null;

  return (
    <div
      className={`flex flex-col flex-1 h-full min-h-0 min-w-0 transition-colors ${
        isDark ? 'bg-slate-900 text-slate-100' : 'bg-slate-50 text-slate-900'
      }`}
    >
      {/* Top Header Bar */}
      <header
        className={`flex items-center justify-between px-4 py-3 border-b shrink-0 ${
          isDark ? 'border-slate-800 bg-slate-950/70 backdrop-blur-md' : 'border-slate-200 bg-white/90 backdrop-blur-md shadow-xs'
        }`}
      >
        <div className="flex items-center gap-3">
          {/* Mobile Sidebar Toggle */}
          <button
            onClick={onOpenMobileSidebar}
            className="md:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-sm md:text-base tracking-tight truncate">
                {uploadedFile ? `${uploadedFile.fileName}` : 'Interactive Network Assistant'}
              </h2>
            </div>
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
              <span>{t.contextBadge}</span>
              {uploadedFile?.extractedConfig && (
                <span className={`font-mono font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                  {uploadedFile.extractedConfig.hostname}
                </span>
              )}
              {vendorContext ? (
                <span
                  className={`font-semibold px-2 py-0.2 rounded text-[10px] border ${
                    vendorContext.includes('Cisco')
                      ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                      : vendorContext.includes('Huawei')
                      ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  }`}
                >
                  {vendorContext}
                </span>
              ) : (
                <span className="font-medium text-slate-500">{t.noContext}</span>
              )}
            </p>
          </div>
        </div>

        {/* Right Header Actions */}
        <div className="flex items-center gap-1.5">
          {messages.length > 0 && (
            <button
              onClick={handleExportChat}
              title={t.exportChat}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                isDark
                  ? 'border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300'
                  : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-700'
              }`}
            >
              <Download className="w-3.5 h-3.5 text-slate-400" />
              <span className="hidden sm:inline">{t.exportChat}</span>
            </button>
          )}

          {messages.length > 0 && (
            <button
              onClick={onResetChat}
              title={t.resetChat}
              className={`p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {topPanel}

      {/* Chat Message Feed */}
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="h-full overflow-y-auto overflow-x-hidden p-4 md:p-6 max-w-full">
          <div ref={contentRef} className="space-y-4">
            {messages.length === 0 && !pendingReply ? (
              /* Empty State / Welcome Screen */
              <div className="max-w-2xl mx-auto py-8 text-center space-y-6 animate-in fade-in duration-300">
                <div className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-600 via-sky-500 to-indigo-600 text-white shadow-xl shadow-cyan-500/20">
                  <Network className="w-8 h-8" />
                </div>

                <div>
                  <h2 className="text-xl md:text-2xl font-extrabold tracking-tight">
                    {t.welcomeTitle}
                  </h2>
                  <p className={`text-xs md:text-sm mt-2 max-w-lg mx-auto leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    {t.welcomeDesc}
                  </p>
                </div>

                {/* Quick Starters Grid */}
                <div className="text-left pt-2">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 text-center">
                    {t.quickStartersTitle}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {[
                      {
                        icon: <Layers className="w-4 h-4 text-cyan-400" />,
                        text: t.starter1,
                        prompt: isTH
                          ? 'ช่วยสรุปการตั้งค่า VLAN, IP Gateway, และ Interface ทั้งหมดใน Configuration นี้'
                          : 'Summarize all active VLANs, IP Gateways, and Interfaces from this config'
                      },
                      {
                        icon: <Terminal className="w-4 h-4 text-purple-400" />,
                        text: t.starter2,
                        prompt: isTH
                          ? 'อธิบายวิธีแปลงคำสั่ง Trunk Port และ Access Port จาก Cisco IOS เป็น Huawei VRP'
                          : 'Explain how to convert Cisco trunk port and access port commands to Huawei VRP syntax'
                      },
                      {
                        icon: <FileCode2 className="w-4 h-4 text-sky-400" />,
                        text: t.starter3,
                        prompt: isTH
                          ? 'วิเคราะห์ไฟล์นี้และสร้าง Mermaid.js Topology Diagram เพื่อดูโครงสร้างการเชื่อมต่อเครือข่าย'
                          : 'Analyze this configuration and generate a Mermaid.js diagram showing connected networks and VLANs'
                      },
                      {
                        icon: <Shield className="w-4 h-4 text-emerald-400" />,
                        text: t.starter4,
                        prompt: isTH
                          ? 'ช่วยตรวจสอบความปลอดภัย (Security Audit) และจุดบกพร่องตาม Best Practice ของไฟล์นี้'
                          : 'Run a network security and best-practice audit on this configuration'
                      }
                    ].map((item, idx) => (
                      <button
                        key={idx}
                        onClick={() => onQuickPrompt(item.prompt)}
                        className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all group cursor-pointer ${
                          isDark
                            ? 'border-slate-800 bg-slate-950/60 hover:border-cyan-500/50 hover:bg-slate-800/80 text-slate-200'
                            : 'border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50/50 text-slate-800 shadow-xs'
                        }`}
                      >
                        <div className="p-2 rounded-lg bg-slate-800/50 shrink-0 group-hover:scale-105 transition-transform">
                          {item.icon}
                        </div>
                        <div className="min-w-0">
                          <span className="text-xs font-semibold block leading-snug group-hover:text-cyan-400 transition-colors">
                            {item.text}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              /* Render Messages Feed */
              messages.map((message) => (
                <ChatMessageItem
                  key={message.id}
                  message={message}
                  theme={settings.theme}
                  language={settings.currentLanguage}
                  activeDiagramCode={activeDiagramCode}
                  onShowDiagram={onShowDiagram}
                  onOpenFullscreenDiagram={onOpenFullscreenDiagram}
                />
              ))
            )}

            {/* Streaming Reply */}
            {pendingReply?.text && (
              <ChatMessageItem
                message={{
                  id: pendingReply.id,
                  sender: 'assistant',
                  timestamp: pendingReply.timestamp,
                  vendorTag: pendingReply.vendorTag,
                  text: pendingReply.text
                }}
                theme={settings.theme}
                language={settings.currentLanguage}
                isStreaming
                activeDiagramCode={activeDiagramCode}
                onShowDiagram={onShowDiagram}
                onOpenFullscreenDiagram={onOpenFullscreenDiagram}
              />
            )}

            {/* Loading Indicator (until the first streamed text arrives) */}
            {isGenerating && !pendingReply?.text && (
              <div className="flex items-center gap-3 p-4 rounded-xl max-w-md animate-pulse">
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                    isDark ? 'bg-slate-800 text-cyan-400 border border-cyan-500/30' : 'bg-blue-50 text-blue-600 border border-blue-200'
                  }`}
                >
                  <Network className="w-4 h-4 animate-spin text-cyan-400" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-cyan-400 flex items-center gap-1.5">
                    <span>{t.sending}</span>
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {isTH ? 'กำลังวิเคราะห์คำสั่งและประมวลผล Topology...' : 'Analyzing configuration syntax and computing topology...'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Shown when the user has scrolled away from the latest message */}
        {!isPinned && (messages.length > 0 || pendingReply) && (
          <button
            onClick={() => scrollToBottom('smooth')}
            className={`absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-lg transition-all cursor-pointer active:scale-95 ${
              isDark
                ? 'border-cyan-500/40 bg-slate-900/95 text-cyan-300 hover:bg-slate-800'
                : 'border-blue-300 bg-white/95 text-blue-700 hover:bg-blue-50'
            }`}
          >
            <ArrowDown className={`h-3.5 w-3.5 ${isGenerating ? 'animate-bounce' : ''}`} />
            {t.jumpToLatest}
          </button>
        )}
      </div>

      {/* Preset Suggestion Chips (Above Input) */}
      <div className={`px-4 py-2 border-t flex items-center gap-2 overflow-x-auto text-[11px] scrollbar-none ${
        isDark ? 'border-slate-800 bg-slate-950/40' : 'border-slate-200 bg-slate-100/60'
      }`}>
        <span className="text-slate-500 shrink-0 font-medium flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-cyan-400" />
          {isTH ? 'คำถามแนะนำ:' : 'Suggestions:'}
        </span>
        {[
          isTH ? 'สรุป VLAN และ Subnet' : 'Summarize VLANs & Subnets',
          isTH ? 'วิธีแปลงคำสั่ง Trunk ใน Huawei' : 'Convert Cisco trunk to Huawei',
          isTH ? 'อธิบาย SVI Gateway' : 'Explain SVI Gateways',
          isTH ? 'เปรียบเทียบ OSPF Cisco vs Huawei' : 'Compare Cisco vs Huawei OSPF'
        ].map((chip, i) => (
          <button
            key={i}
            onClick={() => onQuickPrompt(chip)}
            className={`whitespace-nowrap px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
              isDark
                ? 'border-slate-800 bg-slate-900 text-slate-300 hover:border-cyan-500/40 hover:text-cyan-300'
                : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:text-blue-700 shadow-2xs'
            }`}
          >
            {chip}
          </button>
        ))}
      </div>

      {/* Message Input Area (Bottom Fixed) */}
      <div
        className={`p-4 border-t shrink-0 ${
          isDark ? 'border-slate-800 bg-slate-950/80 backdrop-blur-md' : 'border-slate-200 bg-white'
        }`}
      >
        <div className="max-w-4xl mx-auto flex items-end gap-2">
          <div
            className={`flex-1 relative flex items-center rounded-2xl border transition-all focus-within:ring-2 focus-within:ring-cyan-500/50 ${
              isDark
                ? 'bg-slate-900 border-slate-700 text-slate-100'
                : 'bg-slate-50 border-slate-300 text-slate-900 shadow-inner'
            }`}
          >
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t.inputPlaceholder}
              disabled={isGenerating}
              className="w-full max-h-36 py-3 px-4 text-xs md:text-sm bg-transparent outline-none resize-none leading-relaxed placeholder:text-slate-500"
            />
          </div>

          {isGenerating ? (
            <button
              onClick={onStopGenerating}
              title={t.stopGenerating}
              aria-label={t.stopGenerating}
              className={`p-3 rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 border ${
                isDark
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
                  : 'border-rose-300 bg-rose-50 text-rose-600 hover:bg-rose-100'
              }`}
            >
              <Square className="w-5 h-5 fill-current" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!inputText.trim()}
              title={t.send}
              className={`p-3 rounded-xl flex items-center justify-center transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                inputText.trim()
                  ? isDark
                    ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold shadow-md shadow-cyan-500/25 active:scale-95'
                    : 'bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-md shadow-blue-500/25 active:scale-95'
                  : isDark
                  ? 'bg-slate-800 text-slate-500'
                  : 'bg-slate-200 text-slate-400'
              }`}
            >
              <Send className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="max-w-4xl mx-auto mt-2 flex items-center justify-between text-[11px] text-slate-500">
          <span>
            {isOnline ? t.onlineModeNotice : t.offlineModeNotice}
          </span>
          <span className="hidden sm:inline">Press Shift + Enter for new line</span>
        </div>
      </div>
    </div>
  );
};
