import { ParsedNetworkConfig } from '../types/network';

export function generateMermaidTopology(parsed: ParsedNetworkConfig): string {
  const devId = 'Device';
  const hostname = parsed.hostname || 'NetworkDevice';
  const vendor = parsed.vendor;
  const isRouter = parsed.deviceType === 'Router';

  let icon = '🔀';
  if (parsed.deviceType === 'Core Switch') icon = '⚡';
  else if (isRouter) icon = '🌐';
  else if (parsed.deviceType === 'Switch') icon = '🔲';

  const lines: string[] = [
    'graph TD',
    `    %% Style Definitions with legible typography`,
    `    classDef mainDev fill:#0369a1,stroke:#38bdf8,stroke-width:2.5px,color:#ffffff,font-size:15px;`,
    `    classDef vlanNode fill:#1e293b,stroke:#06b6d4,stroke-width:2px,color:#f8fafc,font-size:14px;`,
    `    classDef switchNode fill:#0f172a,stroke:#64748b,stroke-width:2px,color:#e2e8f0,font-size:14px;`,
    `    classDef wanNode fill:#3b0764,stroke:#a855f7,stroke-width:2.5px,color:#f3e8ff,font-size:14px;`,
    `    classDef hostNode fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#ecfdf5,font-size:14px;`,
    ``,
    `    %% Core Device`,
    `    ${devId}["<b>${icon} ${hostname}</b><br/><span>${vendor} • ${parsed.deviceType}</span>"]`,
    `    class ${devId} mainDev;`
  ];

  // 1. Render VLAN Subnets & Gateways
  if (parsed.vlans.length > 0) {
    parsed.vlans.slice(0, 6).forEach((v, idx) => {
      const nodeId = `VlanNode_${idx}`;
      const ipText = v.ipAddress ? `<br/><code>${v.ipAddress}</code>` : '';
      const nameText = v.name ? ` (${v.name})` : '';
      lines.push(`    ${nodeId}["<b>📂 VLAN ${v.id}</b>${nameText}${ipText}"]`);
      lines.push(`    ${devId} ---|"L3 SVI / Gateway"| ${nodeId}`);
      lines.push(`    class ${nodeId} vlanNode;`);
    });
  }

  // 2. Render Trunk Links to Access Switches
  const trunkPorts = parsed.interfaces.filter(i => i.mode === 'trunk');
  if (trunkPorts.length > 0) {
    trunkPorts.slice(0, 4).forEach((tp, idx) => {
      const swId = `AccSW_${idx}`;
      const desc = tp.description || `Access Switch 0${idx + 1}`;
      const allowed = tp.allowedVlans ? `<br/><span>VLANs: ${tp.allowedVlans}</span>` : '';
      lines.push(`    ${swId}["<b>🔲 ${desc}</b>${allowed}"]`);
      lines.push(`    ${devId} ===|"Trunk ${tp.name}"| ${swId}`);
      lines.push(`    class ${swId} switchNode;`);
    });
  }

  // 3. Render WAN / Uplink / Gateway if present
  const staticRoute = parsed.routing.find(r => r.protocol === 'Static');
  const wanPort = parsed.interfaces.find(i =>
    i.description?.toLowerCase().includes('wan') ||
    i.description?.toLowerCase().includes('firewall') ||
    i.description?.toLowerCase().includes('isp') ||
    (i.name.includes('0/1') && isRouter)
  );

  if (wanPort || staticRoute) {
    const wanId = 'WAN_Gateway';
    const label = wanPort?.description || 'WAN / Next-Hop Gateway';
    const portText = wanPort ? wanPort.name : 'Uplink';
    lines.push(`    ${wanId}["<b>☁️ ${label}</b>"]`);
    lines.push(`    ${devId} -.-|"${portText}"| ${wanId}`);
    lines.push(`    class ${wanId} wanNode;`);
  }

  // Fallback if very minimal config
  if (parsed.vlans.length === 0 && trunkPorts.length === 0) {
    lines.push(`    HostNet["<b>💻 Local LAN Devices</b>"]`);
    lines.push(`    ${devId} ---|"Access Ports"| HostNet`);
    lines.push(`    class HostNet hostNode;`);
  }

  return lines.join('\n');
}

export function generateAsciiTopology(parsed: ParsedNetworkConfig): string {
  const hostname = parsed.hostname;
  const vendor = parsed.vendor;
  const trunks = parsed.interfaces.filter(i => i.mode === 'trunk').map(t => t.name).join(', ') || 'None';
  const vlans = parsed.vlans.map(v => `VLAN ${v.id}${v.ipAddress ? ` (${v.ipAddress})` : ''}`).join(', ') || 'Default';

  return `
+-------------------------------------------------------------+
|                     [ WAN / INTERNET ]                     |
+-------------------------------------------------------------+
                              |
                     (Default Route / Uplink)
                              v
       +===============================================+
       |   DEVICE: ${hostname.padEnd(35)} |
       |   VENDOR: ${vendor.padEnd(35)} |
       |   ROLE  : ${parsed.deviceType.padEnd(35)} |
       +===============================================+
             |                                    |
     [Trunk Ports: ${trunks}]               [L3 SVI / Vlanif Gateways]
             |                                    |
             v                                    v
   +-------------------+                +-------------------+
   | Access Layer SWs  |                | Active Subnets    |
   | (Floors / Dep.)   |                | ${vlans.slice(0, 40)} |
   +-------------------+                +-------------------+
`;
}
