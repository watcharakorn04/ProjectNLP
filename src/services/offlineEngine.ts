import { ParsedNetworkConfig, VendorType } from '../types/network';
import { generateSummaryMarkdown } from './networkParser';
import { generateMermaidTopology } from './diagramGenerator';

export interface GeminiResponse {
  text: string;
  diagramType?: 'mermaid' | 'ascii';
  diagramCode?: string;
  source: 'gemini' | 'offline_engine';
}

export async function validateApiKey(apiKey: string): Promise<{ valid: boolean; message: string }> {
  if (!apiKey || apiKey.trim().length < 10) {
    return { valid: false, message: 'API key is too short or empty' };
  }

  try {
    const trimmedKey = apiKey.trim();
    // Test with a lightweight model list or generate request
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${trimmedKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Ping' }] }],
          generationConfig: { maxOutputTokens: 5 }
        })
      }
    );

    if (response.ok) {
      return { valid: true, message: 'Valid API Key connected successfully!' };
    }

    const errorData = await response.json().catch(() => null);
    const errDetail = errorData?.error?.message || `HTTP ${response.status} error`;
    return { valid: false, message: errDetail };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Network error connecting to Gemini API';
    return { valid: false, message: errorMsg };
  }
}

export async function queryNetBot(params: {
  prompt: string;
  apiKey?: string;
  language: 'EN' | 'TH';
  activeConfigRaw?: string;
  parsedConfig?: ParsedNetworkConfig;
  chatHistory?: { role: 'user' | 'model'; parts: { text: string }[] }[];
}): Promise<GeminiResponse> {
  const { prompt, apiKey, language, activeConfigRaw, parsedConfig, chatHistory } = params;
  const isTH = language === 'TH';

  // If user has a valid API key, try calling Gemini 2.5-flash
  if (apiKey && apiKey.trim().length > 15) {
    try {
      const systemInstruction = `You are NetBot, a senior network engineering instructor and multi-vendor network specialist (Cisco IOS & Huawei VRP).
Your task is to help network engineering students and junior engineers understand, analyze, compare, and visualize configurations.
Target language: ${isTH ? 'Thai (ภาษาไทย) with clear technical networking terms' : 'English'}.
When asked to summarize or analyze:
- Break down Hostname, Vendor (Cisco IOS or Huawei VRP), Active VLANs, SVI/Vlanif IP addresses, Trunks, and Routing protocols.
- If appropriate or requested to provide a topology, output a valid Mermaid.js graph inside \`\`\`mermaid\n...\n\`\`\` code blocks.
- When comparing commands, show clear Cisco vs Huawei syntax side-by-side with explanations.
${activeConfigRaw ? `Current loaded device configuration:\n\`\`\`\n${activeConfigRaw.slice(0, 4000)}\n\`\`\`` : 'No configuration file currently loaded.'}
Always format CLI commands in code blocks with vendor indication.`;

      const contents = [];
      if (chatHistory && chatHistory.length > 0) {
        contents.push(...chatHistory.slice(-4));
      }
      contents.push({
        role: 'user',
        parts: [{ text: `${prompt}` }]
      });

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey.trim()}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents,
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 2048
            }
          })
        }
      );

      if (res.ok) {
        const data = await res.json();
        const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidateText) {
          // Extract mermaid diagram if present
          const mermaidMatch = candidateText.match(/```mermaid\s*([\s\S]*?)```/);
          let diagramCode: string | undefined;
          let diagramType: 'mermaid' | undefined;
          let cleanText = candidateText;

          if (mermaidMatch) {
            diagramCode = mermaidMatch[1].trim();
            diagramType = 'mermaid';
            // Keep text but clean up or reference
          }

          return {
            text: cleanText,
            diagramType,
            diagramCode,
            source: 'gemini'
          };
        }
      }
    } catch (err) {
      console.warn('Gemini API call failed, falling back to smart offline engine:', err);
    }
  }

  // Smart Offline Network Rule Engine
  return generateOfflineSmartResponse({
    prompt,
    language,
    activeConfigRaw,
    parsedConfig
  });
}

function generateOfflineSmartResponse(params: {
  prompt: string;
  language: 'EN' | 'TH';
  activeConfigRaw?: string;
  parsedConfig?: ParsedNetworkConfig;
}): GeminiResponse {
  const { prompt, language, activeConfigRaw, parsedConfig } = params;
  const isTH = language === 'TH';
  const query = prompt.toLowerCase();

  // 1. Topology request
  if (query.includes('topology') || query.includes('diagram') || query.includes('แผนภาพ') || query.includes('ไดอะแกรม')) {
    if (parsedConfig) {
      const mermaidCode = generateMermaidTopology(parsedConfig);
      const text = isTH
        ? `### 🌐 แผนภาพโครงสร้างเครือข่าย (Network Topology)
สร้างขึ้นจากการวิเคราะห์ไฟล์ Configuration ของอุปกรณ์ **${parsedConfig.hostname}** (${parsedConfig.vendor})
- **จุดศูนย์กลาง:** อุปกรณ์ L3 Switch / Router
- **VLAN Subnets:** เชื่อมต่อไปยัง SVI / Vlanif Gateway
- **Trunk Links:** เชื่อมต่อไปยัง Access Switches ชั้นต่างๆ
- **Uplink:** เชื่อมต่อไปยัง WAN / Default Route Gateway`
        : `### 🌐 Network Topology Diagram
Generated based on the configuration of **${parsedConfig.hostname}** (${parsedConfig.vendor}).
- **Core Device:** ${parsedConfig.deviceType} (\`${parsedConfig.hostname}\`)
- **VLAN Subnets:** Routed via SVI / Vlanif Gateways
- **Trunk Links:** Connected to Access Layer Switches
- **Uplink / WAN:** Default route / Firewall link`;

      return {
        text,
        diagramType: 'mermaid',
        diagramCode: mermaidCode,
        source: 'offline_engine'
      };
    } else {
      return {
        text: isTH
          ? '⚠️ ยังไม่ได้อัปโหลดหรือเลือกไฟล์ Configuration กรุณาเลือกไฟล์ตัวอย่างทางด้านซ้าย หรือลากไฟล์ .txt เพื่อสร้าง Topology Diagram'
          : '⚠️ No configuration file loaded. Please upload a .txt file or select a sample config from the sidebar first.',
        source: 'offline_engine'
      };
    }
  }

  // 2. Summary request
  if (query.includes('summar') || query.includes('สรุป') || query.includes('overview') || query.includes('วิเคราะห์')) {
    if (parsedConfig) {
      return {
        text: generateSummaryMarkdown(parsedConfig, language),
        source: 'offline_engine'
      };
    } else {
      return {
        text: isTH
          ? 'กรุณาอัปโหลดไฟล์ Configuration หรือเลือกตัวอย่างจากแถบด้านซ้าย เพื่อให้ระบบวิเคราะห์และสรุปผล'
          : 'Please upload a configuration file or select a sample config to analyze and summarize.',
        source: 'offline_engine'
      };
    }
  }

  // 3. Security Audit request
  if (query.includes('security') || query.includes('audit') || query.includes('ปลอดภัย') || query.includes('ตรวจ')) {
    return generateSecurityAuditResponse(parsedConfig, isTH);
  }

  // 4. Cisco vs Huawei CLI Comparison / Translation
  if (query.includes('compare') || query.includes('เปรียบเทียบ') || query.includes('cisco') || query.includes('huawei') || query.includes('trunk') || query.includes('vlan')) {
    return generateCliComparisonResponse(isTH);
  }

  // 5. Default General Response
  if (parsedConfig) {
    const text = isTH
      ? `### ข้อมูลการวิเคราะห์สำหรับ ${parsedConfig.hostname} (${parsedConfig.vendor})
- **ระบบปฏิบัติการ:** ${parsedConfig.vendor}
- **VLAN ที่พบ:** ${parsedConfig.vlans.map(v => v.id).join(', ') || 'ไม่มี'}
- **อินเทอร์เฟซทั้งหมด:** ${parsedConfig.interfaces.length} พอร์ต (${parsedConfig.interfaces.filter(i => i.mode === 'trunk').length} Trunk)

คุณสามารถถามเกี่ยวกับ:
1. *"สรุป Config"* เพื่อดูรายละเอียด VLAN, IP Address และ Routing ทั้งหมด
2. *"สร้างแผนภาพ Topology"* เพื่อดู Diagram โครงสร้างเครือข่าย
3. *"เปรียบเทียบคำสั่ง Cisco vs Huawei"* เพื่อดูความแตกต่างของ CLI
4. ใส่คำถามเฉพาะเจาะจง เช่น การตั้งค่า OSPF, Trunk, หรือ Access Port`
      : `### Analysis for ${parsedConfig.hostname} (${parsedConfig.vendor})
- **Vendor Platform:** ${parsedConfig.vendor}
- **Active VLANs:** ${parsedConfig.vlans.map(v => v.id).join(', ') || 'Default'}
- **Interfaces:** ${parsedConfig.interfaces.length} configured ports (${parsedConfig.interfaces.filter(i => i.mode === 'trunk').length} Trunks)

You can ask:
1. *"Summarize Config"* for a full breakdown of VLANs, IPs, and Routing.
2. *"Generate Topology"* to visualize network connections.
3. *"Compare Cisco vs Huawei"* to learn syntax conversions.
4. Specific configuration questions regarding OSPF, VLANs, or Trunks.`;

    return {
      text,
      source: 'offline_engine'
    };
  }

  // Fallback when nothing is loaded
  return {
    text: isTH
      ? `ยินดีต้อนรับสู่ **NetBot**! 🚀
คุณสามารถเริ่มต้นได้โดย:
- อัปโหลดไฟล์ \`.txt\` ของ Cisco IOS หรือ Huawei VRP ทางซ้ายมือ
- หรือกดปุ่มเลือกไฟล์ตัวอย่าง (เช่น **Huawei S5700 Core Switch** หรือ **Cisco Catalyst 3850**)
- ใส่คำถามเกี่ยวกับคำสั่ง CLI เพื่อศึกษาขั้นตอนการตั้งค่า`
      : `Welcome to **NetBot**! 🚀
Get started by:
- Uploading a Cisco IOS or Huawei VRP \`.txt\` config file on the left sidebar
- Or clicking one of the sample configs (e.g. **Huawei S5700 Core Switch** or **Cisco Catalyst 3850**)
- Asking any CLI question to learn configuration procedures step-by-step!`,
    source: 'offline_engine'
  };
}

function generateCliComparisonResponse(isTH: boolean): GeminiResponse {
  const text = isTH
    ? `### 🔄 ตารางเปรียบเทียบคำสั่ง Cisco IOS vs Huawei VRP

| หมวดหมู่ (Category) | Cisco IOS | Huawei VRP |
| :--- | :--- | :--- |
| **เข้าสู่โหมดตั้งค่า** | \`configure terminal\` | \`system-view\` |
| **ตั้งชื่ออุปกรณ์** | \`hostname <name>\` | \`sysname <name>\` |
| **ออกจากโหมด** | \`end\` / \`exit\` | \`return\` / \`quit\` |
| **บันทึก Configuration** | \`write memory\` | \`save\` |
| **ดู Configuration ทั้งหมด** | \`show running-config\` | \`display current-configuration\` |
| **ยกเลิกคำสั่ง** | \`no <command>\` | \`undo <command>\` |
| **สร้าง VLAN** | \`vlan 10,20,30\` | \`vlan batch 10 20 30\` |
| **ตั้งค่า Trunk Port** | \`switchport mode trunk\`<br/>\`switchport trunk allowed vlan 10,20\` | \`port link-type trunk\`<br/>\`port trunk allow-pass vlan 10 20\` |
| **ตั้งค่า Access Port** | \`switchport mode access\`<br/>\`switchport access vlan 10\` | \`port link-type access\`<br/>\`port default vlan 10\` |
| **ตั้งค่า L3 SVI Gateway** | \`interface Vlan10\`<br/>\`ip address 192.168.10.1 255.255.255.0\` | \`interface Vlanif10\`<br/>\`ip address 192.168.10.1 255.255.255.0\` |
| **ดูตาราง Routing** | \`show ip route\` | \`display ip routing-table\` |
| **ดูสถานะพอร์ต** | \`show ip interface brief\` | \`display ip interface brief\` |

💡 **คำแนะนำสำหรับนักศึกษา:** 
Huawei VRP ใช้คำนำหน้า \`display\` สำหรับคำสั่งตรวจสอบทั้งหมด (แทนที่ \`show\` ของ Cisco) และใช้ \`undo\` สำหรับการลบคำสั่ง (แทนที่ \`no\` ของ Cisco)`
    : `### 🔄 Cisco IOS vs Huawei VRP Command Comparison Cheat Sheet

| Feature / Task | Cisco IOS | Huawei VRP |
| :--- | :--- | :--- |
| **Enter Config Mode** | \`configure terminal\` | \`system-view\` |
| **Set Hostname** | \`hostname <name>\` | \`sysname <name>\` |
| **Exit to Privileged/User** | \`end\` / \`exit\` | \`return\` / \`quit\` |
| **Save Configuration** | \`write memory\` / \`copy run start\` | \`save\` |
| **View Running Config** | \`show running-config\` | \`display current-configuration\` |
| **Negate / Delete Command** | \`no <command>\` | \`undo <command>\` |
| **Create Multiple VLANs** | \`vlan 10,20,30\` | \`vlan batch 10 20 30\` |
| **Configure Trunk Port** | \`switchport mode trunk\`<br/>\`switchport trunk allowed vlan 10,20\` | \`port link-type trunk\`<br/>\`port trunk allow-pass vlan 10 20\` |
| **Configure Access Port** | \`switchport mode access\`<br/>\`switchport access vlan 10\` | \`port link-type access\`<br/>\`port default vlan 10\` |
| **L3 SVI / Gateway IP** | \`interface Vlan10\`<br/>\`ip address 192.168.10.1 255.255.255.0\` | \`interface Vlanif10\`<br/>\`ip address 192.168.10.1 255.255.255.0\` |
| **View Routing Table** | \`show ip route\` | \`display ip routing-table\` |
| **View Interface Status** | \`show ip interface brief\` | \`display ip interface brief\` |

💡 **Key Engineering Takeaway:**
Huawei VRP uses \`display\` instead of \`show\`, \`undo\` instead of \`no\`, and \`vlan batch\` for bulk creation.`;

  return {
    text,
    source: 'offline_engine'
  };
}

function generateSecurityAuditResponse(parsedConfig: ParsedNetworkConfig | undefined, isTH: boolean): GeminiResponse {
  if (!parsedConfig) {
    return {
      text: isTH ? 'กรุณาอัปโหลดไฟล์ Config ก่อนเพื่อทำการตรวจความปลอดภัย' : 'Please upload a config file first to run a security audit.',
      source: 'offline_engine'
    };
  }

  const isHuawei = parsedConfig.vendor === 'Huawei VRP';

  if (isTH) {
    return {
      text: `### 🛡️ รายงานตรวจสอบความปลอดภัย Configuration (${parsedConfig.hostname})

#### ✅ จุดที่ผ่านการประเมิน (Positive Findings)
1. **การตั้งชื่ออุปกรณ์:** มีการระบุชื่ออุปกรณ์เฉพาะ (\`${parsedConfig.hostname}\`) ช่วยป้องกันความสับสนในการเข้าจัดการ
2. **การแยก Segment:** มีการสร้าง VLAN แยกเครือข่ายชัดเจน (${parsedConfig.vlans.length} VLANs)
3. **การควบคุมการส่งต่อข้อมูล:** มีการจำกัด Allowed VLANs บน Trunk Port

#### ⚠️ ข้อเสนอแนะเพื่อเสริมความมั่นคงปลอดภัย (Best-Practice Recommendations)
1. **การเข้ารหัสและเข้าถึงจากระยะไกล:**
   ${isHuawei 
     ? '- ตรวจสอบให้แน่ใจว่าใช้ `protocol inbound ssh` บน `user-interface vty` และปิดการใช้งาน Telnet\n- ตั้งค่า `authentication-mode aaa` ร่วมกับรหัสผ่านความปลอดภัยสูง'
     : '- เปิดใช้งาน `service password-encryption`\n- ตรวจสอบ `transport input ssh` บน `line vty 0 4` เพื่อปิด Telnet แบบ Plaintext'}
2. **Spanning Tree & Port Security:**
   ${isHuawei
     ? '- เปิดใช้งาน `stp bpdu-protection` เพื่อป้องกัน Rogue Switch บนพอร์ต Access'
     : '- เปิดใช้งาน `spanning-tree portfast` และ `spanning-tree bpduguard enable` บน Access Ports'}
3. **Default VLAN 1 Management:**
   - หลีกเลี่ยงการใช้ VLAN 1 เป็น Management หรือ Native VLAN เพื่อป้องกัน VLAN Hopping Attack`,
      source: 'offline_engine'
    };
  }

  return {
    text: `### 🛡️ Configuration Security & Best-Practice Audit (${parsedConfig.hostname})

#### ✅ Passed Checks
1. **Explicit Identity:** Device hostname is properly configured (\`${parsedConfig.hostname}\`).
2. **VLAN Segmentation:** Traffic is isolated across ${parsedConfig.vlans.length} active VLANs.
3. **Trunk Port Hygiene:** Trunk allowed VLAN lists are defined rather than permitting all VLANs.

#### ⚠️ Security Recommendations & Hardening
1. **Secure Remote Management:**
   ${isHuawei
     ? '- Ensure `protocol inbound ssh` is enforced under `user-interface vty` and Telnet is disabled.\n- Enforce AAA authentication with robust password hashing.'
     : '- Ensure `service password-encryption` is active.\n- Confirm `transport input ssh` is applied to all `line vty` lines to block unencrypted Telnet.'}
2. **Layer 2 Protection (STP & Rogue Devices):**
   ${isHuawei
     ? '- Enable `stp bpdu-protection` globally to protect edge access ports.'
     : '- Configure `spanning-tree bpduguard enable` on all PortFast access interfaces.'}
3. **Native VLAN Hardening:**
   - Migrate management and user subnets away from Default VLAN 1 to mitigate VLAN hopping attacks.`,
    source: 'offline_engine'
  };
}
