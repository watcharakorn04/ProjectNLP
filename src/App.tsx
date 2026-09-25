/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatFeed } from './components/ChatFeed';
import { RawConfigModal } from './components/RawConfigModal';
import { TopologyModal } from './components/TopologyModal';
import { AppSettings, ChatMessage } from './types/chat';
import { UploadedConfigFile } from './types/network';
import { SAMPLE_CONFIGS } from './utils/sampleConfigs';
import { parseNetworkConfig } from './utils/networkParser';
import { detectVendor } from './utils/vendorDetector';
import { queryNetConfigAI } from './utils/geminiClient';
import { generateMermaidTopology } from './utils/diagramGenerator';

const STORAGE_KEY_SETTINGS = 'netconfig_ai_settings_v1';
const STORAGE_KEY_MESSAGES = 'netconfig_ai_messages_v2';

export default function App() {
  // 1. Settings State
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return {
      currentLanguage: 'EN',
      theme: 'dark',
      apiKey: '',
      apiKeyStatus: 'unset'
    };
  });

  // 2. Uploaded File State (Initialized with PRD mock data)
  const [uploadedFile, setUploadedFile] = useState<UploadedConfigFile | null>(() => {
    const defaultSample = SAMPLE_CONFIGS[0]; // Huawei Core Switch
    const detection = detectVendor(defaultSample.rawContent);
    const parsed = parseNetworkConfig(defaultSample.rawContent);
    const sizeBytes = new Blob([defaultSample.rawContent]).size;

    return {
      fileName: defaultSample.fileName,
      fileSize: `${(sizeBytes / 1024).toFixed(1)} KB`,
      rawContent: defaultSample.rawContent,
      detectedVendor: detection.vendor,
      parsedData: parsed,
      uploadedAt: '10:30 AM'
    };
  });

  // 3. Chat Messages State (Initialized with PRD mock chat history)
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_MESSAGES);
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
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [isRawModalOpen, setIsRawModalOpen] = useState(false);
  const [fullscreenDiagramCode, setFullscreenDiagramCode] = useState<string | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Sync settings to localStorage and apply theme class
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
    } catch {
      // ignore
    }

    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [settings]);

  // Sync messages to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(messages));
    } catch {
      // ignore
    }
  }, [messages]);

  const handleUpdateSettings = (newSettings: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...newSettings }));
  };

  const handleFileLoaded = (file: UploadedConfigFile) => {
    setUploadedFile(file);

    // Add assistant acknowledgment message
    const isTH = settings.currentLanguage === 'TH';
    const parsed = file.parsedData;
    const vendor = file.detectedVendor;

    const ackMessage: ChatMessage = {
      id: `msg_${Date.now()}`,
      sender: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      vendorTag: vendor,
      text: isTH
        ? `📁 **โหลดไฟล์สำเร็จ:** \`${file.fileName}\` (${file.fileSize})
- **ระบบปฏิบัติการที่ตรวจพบ:** \`${vendor}\`
- **ชื่ออุปกรณ์:** \`${parsed?.hostname || 'Unknown'}\` (${parsed?.deviceType || 'Device'})
- **จำนวน VLAN ที่พบ:** ${parsed?.vlans.length || 0} VLANs

คุณสามารถกดปุ่ม **"สรุป Config"** หรือ **"สร้างแผนภาพ Topology"** เพื่อเริ่มการวิเคราะห์ได้ทันที!`
        : `📁 **Loaded Configuration:** \`${file.fileName}\` (${file.fileSize})
- **Auto-detected OS:** \`${vendor}\`
- **Device Hostname:** \`${parsed?.hostname || 'Unknown'}\` (${parsed?.deviceType || 'Device'})
- **Active VLANs:** ${parsed?.vlans.length || 0} VLANs

Click **"Summarize Config"** or **"Generate Topology"** to analyze and visualize!`
    };

    setMessages((prev) => [...prev, ackMessage]);
  };

  const handleRemoveFile = () => {
    setUploadedFile(null);
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isGenerating) return;

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      sender: 'user',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: text.trim()
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsGenerating(true);

    try {
      const response = await queryNetConfigAI({
        prompt: text,
        apiKey: settings.apiKey,
        language: settings.currentLanguage,
        activeConfigRaw: uploadedFile?.rawContent,
        parsedConfig: uploadedFile?.parsedData,
        chatHistory: messages.map((m) => ({
          role: m.sender === 'user' ? 'user' : 'model',
          parts: [{ text: m.text }]
        }))
      });

      const assistantMsg: ChatMessage = {
        id: `msg_${Date.now() + 1}`,
        sender: 'assistant',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: response.text,
        diagramType: response.diagramType,
        diagramCode: response.diagramCode,
        vendorTag: uploadedFile?.detectedVendor
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: unknown) {
      const errorMsg: ChatMessage = {
        id: `msg_${Date.now() + 1}`,
        sender: 'assistant',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: `⚠️ Error processing request: ${err instanceof Error ? err.message : 'Unknown error'}`
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleQuickAction = (actionType: 'summary' | 'topology' | 'compare' | 'security') => {
    const isTH = settings.currentLanguage === 'TH';

    let prompt = '';
    if (actionType === 'summary') {
      prompt = isTH
        ? 'ช่วยสรุป Configuration ของอุปกรณ์นี้ แสดงรายการ VLAN, IP Addresses, Trunks และ Routing ทั้งหมด'
        : 'Summarize this configuration file in detail showing all active VLANs, IP Addresses, Trunk ports, and Routing.';
    } else if (actionType === 'topology') {
      prompt = isTH
        ? 'วิเคราะห์ไฟล์นี้และสร้าง Mermaid.js Topology Diagram แสดงการเชื่อมต่อเครือข่ายและ VLAN Subnets'
        : 'Analyze this config and generate a Mermaid.js diagram showing connected networks and VLANs.';
    } else if (actionType === 'compare') {
      prompt = isTH
        ? 'ช่วยแสดงตารางเปรียบเทียบคำสั่ง CLI ระหว่าง Cisco IOS กับ Huawei VRP สำหรับคำสั่งสำคัญที่พบบ่อย'
        : 'Compare Cisco IOS vs Huawei VRP CLI commands for common configuration tasks.';
    } else if (actionType === 'security') {
      prompt = isTH
        ? 'ช่วยตรวจสอบจุดบกพร่องด้านความปลอดภัย (Security & Best-Practice Audit) ของ Configuration นี้'
        : 'Run a security and best-practice audit on this configuration file.';
    }

    handleSendMessage(prompt);
  };

  const handleResetChat = () => {
    setMessages([]);
  };

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
          onUpdateSettings={handleUpdateSettings}
          uploadedFile={uploadedFile}
          onFileLoaded={handleFileLoaded}
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
              onUpdateSettings={handleUpdateSettings}
              uploadedFile={uploadedFile}
              onFileLoaded={(file) => {
                handleFileLoaded(file);
                setIsMobileSidebarOpen(false);
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
          onSendMessage={handleSendMessage}
          onQuickPrompt={handleSendMessage}
          onResetChat={handleResetChat}
          onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
          onOpenFullscreenDiagram={(code) => setFullscreenDiagramCode(code)}
        />
      </main>

      {/* Raw Configuration Inspection Modal */}
      <RawConfigModal
        isOpen={isRawModalOpen}
        onClose={() => setIsRawModalOpen(false)}
        file={uploadedFile}
        theme={settings.theme}
        language={settings.currentLanguage}
      />

      {/* Fullscreen Topology Modal */}
      <TopologyModal
        isOpen={!!fullscreenDiagramCode}
        onClose={() => setFullscreenDiagramCode(null)}
        mermaidCode={fullscreenDiagramCode}
        theme={settings.theme}
        language={settings.currentLanguage}
      />
    </div>
  );
}
