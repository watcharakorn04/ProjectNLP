/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatFeed } from './components/ChatFeed';
import { RawConfigModal } from './components/RawConfigModal';
import { TopologyModal } from './components/TopologyModal';
import { TopologyCanvas, CanvasStatus } from './components/TopologyCanvas';
import { ToastStack } from './components/ToastStack';
import { useToasts } from './hooks/useToasts';
import { usePersistedSettings } from './hooks/usePersistedSettings';
import { useLlmStream, StreamOutcome } from './hooks/useLlmStream';
import { ChatMessage, PendingReply, SupportedLanguage } from './types/chat';
import { UploadedConfigFile } from './types/network';
import { SAMPLE_CONFIGS } from './utils/sampleConfigs';
import { i18n } from './utils/i18nData';
import {
  ConfigLoadError,
  ConfigLoadResult,
  configSourceFromSample,
  loadConfigSource,
  MAX_CONFIG_BYTES
} from './core/configLoader';
import {
  ACTIONS_REQUIRING_CONFIG,
  FINISH_REASON,
  QUICK_ACTION_LABELS,
  QuickActionType,
  buildChatRequest,
  closeOpenFence,
  extractMermaid,
  hasVerifiedKey
} from './core/llm';
import { GROQ_MODEL } from './services/groqService';
import { LlmError } from './services/llmHttp';
import { generateOfflineResponse } from './services/offlineEngine';

const STORAGE_KEY_MESSAGES = 'netbot_messages_v2';
const LEGACY_STORAGE_KEY_MESSAGES = 'netconfig_ai_messages_v2';

const LOAD_ERROR_TEXT: Record<ConfigLoadError, Record<SupportedLanguage, string>> = {
  empty: {
    EN: 'The file is empty. Export the running config and try again.',
    TH: 'ไฟล์ว่างเปล่า กรุณา export running config แล้วลองใหม่อีกครั้ง'
  },
  unparseable: {
    EN: 'No interfaces, VLANs or routes were found. Make sure this is a Cisco IOS or Huawei VRP running config.',
    TH: 'ไม่พบ Interface, VLAN หรือ Route ในไฟล์ กรุณาตรวจสอบว่าเป็น running config ของ Cisco IOS หรือ Huawei VRP'
  },
  'unsupported-type': {
    EN: 'Unsupported file type. Upload a .txt, .cfg, .conf or .log file.',
    TH: 'ไม่รองรับประเภทไฟล์นี้ กรุณาอัปโหลดไฟล์ .txt, .cfg, .conf หรือ .log'
  },
  'too-large': {
    EN: `File is larger than ${MAX_CONFIG_BYTES / 1024 / 1024} MB.`,
    TH: `ไฟล์มีขนาดเกิน ${MAX_CONFIG_BYTES / 1024 / 1024} MB`
  },
  'read-failed': {
    EN: 'The browser could not read this file.',
    TH: 'เบราว์เซอร์ไม่สามารถอ่านไฟล์นี้ได้'
  }
};

const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const newMessageId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** Diagram attached to a message: an offline-engine diagram, or the last complete ```mermaid block. */
function getMessageDiagram(message: ChatMessage): string | null {
  return message.diagramCode ?? extractMermaid(message.text).latestComplete;
}

function findLatestDiagram(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const diagram = getMessageDiagram(messages[i]);
    if (diagram) return diagram;
  }
  return null;
}

function loadInitialMessages(): ChatMessage[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_MESSAGES) ?? localStorage.getItem(LEGACY_STORAGE_KEY_MESSAGES);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore
  }

  return [
    {
      id: 'msg_001',
      sender: 'user',
      timestamp: '10:30 AM',
      text: 'Summarize this configuration and generate a topology overview.'
    },
    {
      id: 'msg_002',
      sender: 'assistant',
      timestamp: '10:30 AM',
      text: `### Configuration Summary

- **Device Name:** \`Core-Switch-01\`
- **Vendor:** Huawei VRP
- **Active VLANs:** VLAN 10, VLAN 20, VLAN 30, VLAN 99
- **Gateway IPs:**
  - VLAN 10: \`192.168.10.1/24\` (Management & IT)
  - VLAN 20: \`192.168.20.1/24\` (Staff & Engineering)
  - VLAN 30: \`192.168.30.1/24\` (Guest WiFi)
- **Routing:** OSPF Area 0, Default Static Route to Firewall \`10.0.99.2\`

---

### 🌐 Network Topology Diagram`,
      vendorTag: 'Huawei VRP',
      diagramType: 'mermaid',
      diagramCode: `graph TD
    classDef mainDev fill:#0369a1,stroke:#38bdf8,stroke-width:2.5px,color:#ffffff,font-size:15px;
    classDef vlanNode fill:#1e293b,stroke:#06b6d4,stroke-width:2px,color:#f8fafc,font-size:14px;
    classDef switchNode fill:#0f172a,stroke:#64748b,stroke-width:2px,color:#e2e8f0,font-size:14px;
    classDef wanNode fill:#3b0764,stroke:#a855f7,stroke-width:2.5px,color:#f3e8ff,font-size:14px;

    Device["<b>⚡ Core-Switch-01</b><br/><span>Huawei VRP • Core Switch</span>"]
    class Device mainDev;

    Vlan10["<b>📂 VLAN 10 - Management</b><br/><code>192.168.10.1/24</code>"]
    Vlan20["<b>📂 VLAN 20 - Staff</b><br/><code>192.168.20.1/24</code>"]
    Vlan30["<b>📂 VLAN 30 - Guest</b><br/><code>192.168.30.1/24</code>"]
    Device ---|"L3 SVI / Gateway"| Vlan10
    Device ---|"L3 SVI / Gateway"| Vlan20
    Device ---|"L3 SVI / Gateway"| Vlan30
    class Vlan10,Vlan20,Vlan30 vlanNode;

    Acc1["<b>🔲 Access Switch 01</b><br/><span>VLANs: 10, 20, 30</span>"]
    Acc2["<b>🔲 Access Switch 02</b><br/><span>VLANs: 10, 20, 30</span>"]
    Device ===|"Trunk GE0/0/1"| Acc1
    Device ===|"Trunk GE0/0/2"| Acc2
    class Acc1,Acc2 switchNode;

    WAN["<b>☁️ Link to Edge Firewall</b><br/><code>10.0.99.2</code>"]
    Device -.-|"GE0/0/24 (VLAN 99)"| WAN
    class WAN wanNode;`
    }
  ];
}

interface AssistantRequest {
  /** Text shown in the user bubble. */
  displayText: string;
  /** Free-text question (for quick actions, the button label). */
  userText: string;
  action?: QuickActionType;
}

export default function App() {
  // 1. Settings (preferences in localStorage, API key in sessionStorage)
  const { settings, updateSettings, updateCredentials } = usePersistedSettings();

  // 2. Uploaded File State (Initialized with PRD mock data: Huawei Core Switch)
  const [uploadedFile, setUploadedFile] = useState<UploadedConfigFile | null>(() => {
    const result = loadConfigSource(configSourceFromSample(SAMPLE_CONFIGS[0]), '10:30 AM');
    return result.ok ? result.file : null;
  });

  const { toasts, pushToast, dismissToast } = useToasts();

  // 3. Chat Messages State (Initialized with PRD mock chat history)
  const [messages, setMessages] = useState<ChatMessage[]>(loadInitialMessages);

  // 4. Streaming reply + topology canvas
  const [pendingReply, setPendingReply] = useState<Omit<PendingReply, 'text'> | null>(null);
  const { streamText, start: startStream, abort: abortStream, reset: resetStream } = useLlmStream();
  const [activeDiagram, setActiveDiagram] = useState<string | null>(() => findLatestDiagram(messages));
  const [isCanvasCollapsed, setIsCanvasCollapsed] = useState(false);
  /** Id of the reply the current turn may commit; cleared by Reset Chat to drop late results. */
  const activeTurnRef = useRef<string | null>(null);

  const [isRawModalOpen, setIsRawModalOpen] = useState(false);
  const [fullscreenDiagramCode, setFullscreenDiagramCode] = useState<string | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const isGenerating = pendingReply !== null;
  const lang = settings.currentLanguage;
  const isTH = lang === 'TH';
  const t = i18n[lang];

  // Sync messages to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(messages));
    } catch {
      // ignore
    }
  }, [messages]);

  // Live diagram extraction from the streaming reply. Only closed ```mermaid blocks are rendered.
  const streamDiagram = useMemo(() => extractMermaid(isGenerating ? streamText : ''), [isGenerating, streamText]);
  const canvasStatus: CanvasStatus =
    streamDiagram.pending !== null ? 'drawing' : streamDiagram.latestComplete ? 'live' : 'idle';
  const canvasCode = streamDiagram.latestComplete ?? activeDiagram;

  // A diagram starting to stream in is worth showing even if the canvas was collapsed.
  useEffect(() => {
    if (canvasStatus === 'drawing') setIsCanvasCollapsed(false);
  }, [canvasStatus]);

  /** Applies a load attempt from the uploader. Returns true when a new config became active. */
  const handleConfigLoaded = (result: ConfigLoadResult): boolean => {
    if (!result.ok) {
      pushToast({
        tone: 'error',
        title: isTH ? `โหลด ${result.fileName} ไม่สำเร็จ` : `Couldn't load ${result.fileName}`,
        description: LOAD_ERROR_TEXT[result.error][lang]
      });
      return false;
    }

    const { file, warnings } = result;
    setUploadedFile(file);

    if (warnings.length > 0) {
      pushToast({
        tone: 'warning',
        title: isTH ? `โหลด ${file.fileName} แล้ว (มีคำเตือน)` : `Loaded ${file.fileName} with warnings`,
        description: warnings.join(' ')
      });
    }

    const cfg = file.extractedConfig;
    const vendor = file.detectedVendor;
    const hostname = cfg?.hostname ?? 'Unknown';
    const deviceType = file.parsedData?.deviceType ?? 'Device';
    const vlanCount = cfg?.vlans.length ?? 0;
    const ifaceCount = cfg?.interfaces.length ?? 0;
    const sviCount = cfg?.sviGateways.length ?? 0;
    const routeCount = cfg?.staticRoutes.length ?? 0;

    const ackMessage: ChatMessage = {
      id: newMessageId(),
      sender: 'assistant',
      timestamp: nowTime(),
      vendorTag: vendor,
      text: isTH
        ? `📁 **โหลดไฟล์สำเร็จ:** \`${file.fileName}\` (${file.fileSize})
- **ระบบปฏิบัติการที่ตรวจพบ:** \`${vendor}\`
- **ชื่ออุปกรณ์:** \`${hostname}\` (${deviceType})
- **จำนวน VLAN ที่พบ:** ${vlanCount} VLANs
- **Interface:** ${ifaceCount} พอร์ต • **SVI Gateway:** ${sviCount} • **Static Route:** ${routeCount}

คุณสามารถกดปุ่ม **"สรุป Config"** หรือ **"สร้างแผนภาพ Topology"** เพื่อเริ่มการวิเคราะห์ได้ทันที!`
        : `📁 **Loaded Configuration:** \`${file.fileName}\` (${file.fileSize})
- **Auto-detected OS:** \`${vendor}\`
- **Device Hostname:** \`${hostname}\` (${deviceType})
- **Active VLANs:** ${vlanCount} VLANs
- **Interfaces:** ${ifaceCount} • **SVI Gateways:** ${sviCount} • **Static Routes:** ${routeCount}

Click **"Summarize Config"** or **"Generate Topology"** to analyze and visualize!`
    };

    setMessages((prev) => [...prev, ackMessage]);
    return true;
  };

  const handleRemoveFile = () => {
    setUploadedFile(null);
  };

  const commitReply = (message: ChatMessage) => {
    if (activeTurnRef.current !== message.id) return;
    activeTurnRef.current = null;

    setMessages((prev) => [...prev, message]);
    setPendingReply(null);
    resetStream();

    const diagram = getMessageDiagram(message);
    if (diagram) setActiveDiagram(diagram);
  };

  /** Toasts a Groq failure. `fellBack` is true when the offline engine answers the turn instead. */
  const reportLlmError = (error: LlmError, fellBack: boolean) => {
    if (error.kind === 'invalid-key') {
      updateCredentials({ status: 'invalid', errorMessage: error.message });
      pushToast({
        tone: 'error',
        title: isTH ? 'Groq API Key ถูกปฏิเสธ' : 'Groq API key rejected',
        description: isTH
          ? 'สลับไปใช้ Smart Rule Engine แล้ว กรุณาตรวจสอบ Key ในแถบด้านซ้าย'
          : 'Switched to the offline engine. Check the key in the sidebar.'
      });
      return;
    }
    pushToast({
      tone: error.kind === 'rate-limit' || fellBack ? 'warning' : 'error',
      title:
        error.kind === 'rate-limit'
          ? isTH ? 'ใช้งาน Groq เกินโควตา' : 'Groq rate limit reached'
          : isTH ? 'เรียก Groq ไม่สำเร็จ' : 'Groq request failed',
      description: fellBack
        ? `${error.message} — ${isTH ? 'สลับไปใช้ Smart Rule Engine' : 'switching to the offline engine'}`
        : error.message
    });
  };

  /** Turns a finished (or failed / stopped) stream into the message that is committed to history. */
  const buildLlmReply = (reply: Omit<PendingReply, 'text'>, outcome: StreamOutcome): ChatMessage => {
    const notes: string[] = [];
    if (outcome.aborted) notes.push(`**⏹ ${t.generationStopped}**`);
    if (outcome.error) {
      reportLlmError(outcome.error, false);
      notes.push(`**⚠️ ${isTH ? 'การสตรีมถูกขัดจังหวะ' : 'Stream interrupted'}:** ${outcome.error.message}`);
    }
    if (outcome.finishReason === FINISH_REASON.length) {
      notes.push(isTH ? '**⚠️ คำตอบถูกตัดเนื่องจากยาวเกินขีดจำกัด**' : '**⚠️ Response truncated at the maximum output length.**');
    } else if (outcome.finishReason && outcome.finishReason !== FINISH_REASON.stop) {
      notes.push(`**⚠️ ${isTH ? 'Groq หยุดก่อนจบคำตอบ' : 'Groq stopped early'} (${outcome.finishReason}).**`);
    }

    const body = outcome.text.trim() ? closeOpenFence(outcome.text.trim()) : '';
    return {
      ...reply,
      sender: 'assistant',
      text: [body, ...notes].filter(Boolean).join('\n\n'),
      metadata: {
        source: 'groq',
        model: outcome.model ?? GROQ_MODEL,
        tokensUsed: outcome.usage?.totalTokens,
        finishReason: outcome.finishReason !== FINISH_REASON.stop ? outcome.finishReason : undefined,
        isError: !body
      }
    };
  };

  const runAssistantTurn = async (request: AssistantRequest) => {
    if (isGenerating || !request.userText.trim()) return;

    const history = messages;
    setMessages((prev) => [
      ...prev,
      { id: newMessageId(), sender: 'user', timestamp: nowTime(), text: request.displayText }
    ]);

    const reply = { id: newMessageId(), timestamp: nowTime(), vendorTag: uploadedFile?.detectedVendor };
    activeTurnRef.current = reply.id;

    const offlineReply = (notice?: string): ChatMessage => {
      const response = generateOfflineResponse({
        prompt: request.userText,
        intent: request.action,
        language: lang,
        parsedConfig: uploadedFile?.parsedData
      });
      return {
        ...reply,
        sender: 'assistant',
        text: notice ? `${notice}\n\n${response.text}` : response.text,
        diagramType: response.diagramType,
        diagramCode: response.diagramCode,
        metadata: { source: 'offline_engine' }
      };
    };

    // Groq → offline engine: no verified key (or a quick action with no config) goes straight offline.
    const missingConfig = request.action !== undefined && ACTIONS_REQUIRING_CONFIG.has(request.action) && !uploadedFile;
    if (missingConfig || !hasVerifiedKey(settings.credentials)) {
      commitReply(offlineReply());
      return;
    }

    setPendingReply(reply);
    const body = buildChatRequest({ language: lang, file: uploadedFile, history, userText: request.userText, action: request.action });
    const outcome = await startStream(settings.credentials.apiKey, body);

    if (!outcome.error || outcome.text.trim()) {
      commitReply(buildLlmReply(reply, outcome));
      return;
    }

    // Groq failed before producing any text: the offline engine answers instead.
    // Reset Chat during the request drops the turn, so don't toast about it.
    if (activeTurnRef.current !== reply.id) return;
    reportLlmError(outcome.error, true);
    const notice = isTH
      ? `**⚠️ Groq ไม่พร้อมใช้งาน (${outcome.error.message}) — แสดงผลจาก Smart Rule Engine แทน**`
      : `**⚠️ Groq unavailable (${outcome.error.message}) — showing the Smart Rule Engine result instead.**`;
    commitReply(offlineReply(notice));
  };

  const handleSendMessage = (text: string) => {
    const trimmed = text.trim();
    runAssistantTurn({ displayText: trimmed, userText: trimmed });
  };

  const handleQuickAction = (action: QuickActionType) => {
    const label = QUICK_ACTION_LABELS[action][lang];
    runAssistantTurn({ displayText: label, userText: label, action });
  };

  const handleResetChat = () => {
    activeTurnRef.current = null;
    abortStream();
    resetStream();
    setPendingReply(null);
    setMessages([]);
    setActiveDiagram(null);
  };

  // Stable callbacks: memoised chat bubbles re-render only when their own message changes.
  const handleShowDiagram = useCallback((code: string) => {
    setActiveDiagram(code);
    setIsCanvasCollapsed(false);
  }, []);
  const handleOpenFullscreenDiagram = useCallback((code: string) => setFullscreenDiagramCode(code), []);

  const isDark = settings.theme === 'dark';

  return (
    <div
      className={`flex h-screen w-screen overflow-hidden font-sans transition-colors ${
        isDark ? 'bg-slate-900 text-slate-100' : 'bg-slate-50 text-slate-900'
      }`}
    >
      {/* Desktop Sidebar */}
      <div className="hidden md:flex h-full shrink-0">
        <Sidebar
          settings={settings}
          onUpdateSettings={updateSettings}
          onUpdateCredentials={updateCredentials}
          uploadedFile={uploadedFile}
          onConfigLoaded={handleConfigLoaded}
          onRemoveFile={handleRemoveFile}
          onOpenRawViewer={() => setIsRawModalOpen(true)}
          onQuickAction={handleQuickAction}
          onResetChat={handleResetChat}
          isGenerating={isGenerating}
        />
      </div>

      {/* Mobile Drawer Overlay */}
      {isMobileSidebarOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
          <div className="relative w-80 max-w-[85vw] h-full z-10 shadow-2xl animate-in slide-in-from-left duration-200">
            <Sidebar
              settings={settings}
              onUpdateSettings={updateSettings}
              onUpdateCredentials={updateCredentials}
              uploadedFile={uploadedFile}
              onConfigLoaded={(result) => {
                // Keep the drawer open on failure so the user can retry right away.
                if (handleConfigLoaded(result)) setIsMobileSidebarOpen(false);
              }}
              onRemoveFile={handleRemoveFile}
              onOpenRawViewer={() => {
                setIsRawModalOpen(true);
                setIsMobileSidebarOpen(false);
              }}
              onQuickAction={(action) => {
                handleQuickAction(action);
                setIsMobileSidebarOpen(false);
              }}
              onResetChat={() => {
                handleResetChat();
                setIsMobileSidebarOpen(false);
              }}
              isGenerating={isGenerating}
            />
          </div>
        </div>
      )}

      {/* Main Chat & Visualization Area */}
      <main className="flex-1 flex flex-col h-full min-w-0">
        <ChatFeed
          messages={messages}
          settings={settings}
          uploadedFile={uploadedFile}
          isGenerating={isGenerating}
          pendingReply={pendingReply ? { ...pendingReply, text: streamText } : null}
          activeDiagramCode={canvasCode}
          topPanel={
            <TopologyCanvas
              code={canvasCode}
              status={canvasStatus}
              pendingLineCount={streamDiagram.pending ? streamDiagram.pending.split('\n').length : 0}
              collapsed={isCanvasCollapsed}
              onToggleCollapsed={() => setIsCanvasCollapsed((prev) => !prev)}
              onOpenFullscreen={handleOpenFullscreenDiagram}
              onGenerate={() => handleQuickAction('topology')}
              canGenerate={!isGenerating}
              theme={settings.theme}
              language={lang}
            />
          }
          onSendMessage={handleSendMessage}
          onQuickPrompt={handleSendMessage}
          onStopGenerating={abortStream}
          onResetChat={handleResetChat}
          onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
          onOpenFullscreenDiagram={handleOpenFullscreenDiagram}
          onShowDiagram={handleShowDiagram}
        />
      </main>

      {/* Raw Configuration Inspection Modal */}
      <RawConfigModal
        isOpen={isRawModalOpen}
        onClose={() => setIsRawModalOpen(false)}
        file={uploadedFile}
        theme={settings.theme}
        language={lang}
      />

      {/* Fullscreen Topology Modal */}
      <TopologyModal
        isOpen={!!fullscreenDiagramCode}
        onClose={() => setFullscreenDiagramCode(null)}
        mermaidCode={fullscreenDiagramCode}
        theme={settings.theme}
        language={lang}
      />

      <ToastStack toasts={toasts} onDismiss={dismissToast} theme={settings.theme} />
    </div>
  );
}
