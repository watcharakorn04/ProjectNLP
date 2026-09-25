import { ParsedNetworkConfig, VlanInfo, InterfaceInfo, RoutingProtocol, VendorType } from '../types/network';
import { detectVendor } from './vendorDetector';

export function parseNetworkConfig(content: string): ParsedNetworkConfig {
  const vendorResult = detectVendor(content);
  const vendor: VendorType = vendorResult.vendor;
  const lines = content.split('\n');

  let hostname = 'Unknown-Device';
  let deviceType: ParsedNetworkConfig['deviceType'] = 'Switch';
  const vlans: VlanInfo[] = [];
  const interfaces: InterfaceInfo[] = [];
  const routing: RoutingProtocol[] = [];
  const acls: string[] = [];

  // 1. Extract Hostname / Sysname
  for (const line of lines) {
    const trimmed = line.trim();
    if (vendor === 'Huawei VRP' || trimmed.startsWith('sysname')) {
      const match = trimmed.match(/^sysname\s+([\w\-.]+)/i);
      if (match) {
        hostname = match[1];
        break;
      }
    }
    if (vendor === 'Cisco IOS' || trimmed.startsWith('hostname')) {
      const match = trimmed.match(/^hostname\s+([\w\-.]+)/i);
      if (match) {
        hostname = match[1];
        break;
      }
    }
  }

  // 2. Parse Interfaces & VLANs
  let currentInterface: InterfaceInfo | null = null;
  let inVlanDef = false;
  let currentVlanId: number | string | null = null;
  let currentVlanName: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check for ACLs
    if (trimmed.match(/^(ip access-list|access-list|acl number|rule \d+)/i)) {
      acls.push(trimmed);
    }

    // Huawei VLAN batch
    if (trimmed.startsWith('vlan batch')) {
      const vlanParts = trimmed.replace('vlan batch', '').trim().split(/\s+/);
      for (const part of vlanParts) {
        if (part.includes('to')) {
          const [start, end] = part.split('to').map(Number);
          if (!isNaN(start) && !isNaN(end)) {
            for (let v = start; v <= end; v++) {
              if (!vlans.some(vl => String(vl.id) === String(v))) {
                vlans.push({ id: v, name: `VLAN_${v}` });
              }
            }
          }
        } else {
          const num = Number(part);
          if (!isNaN(num) && !vlans.some(vl => String(vl.id) === String(num))) {
            vlans.push({ id: num, name: `VLAN_${num}` });
          }
        }
      }
    }

    // Cisco single VLAN block: vlan 10 \n name Corporate
    const ciscoVlanMatch = trimmed.match(/^vlan\s+(\d+)$/i);
    if (ciscoVlanMatch) {
      currentVlanId = ciscoVlanMatch[1];
      inVlanDef = true;
      continue;
    }
    if (inVlanDef && currentVlanId) {
      if (trimmed.startsWith('name ')) {
        currentVlanName = trimmed.replace('name ', '').trim();
      } else if (trimmed === '!' || trimmed.startsWith('interface') || trimmed.startsWith('vlan')) {
        if (!vlans.some(vl => String(vl.id) === String(currentVlanId))) {
          vlans.push({ id: currentVlanId, name: currentVlanName || `VLAN_${currentVlanId}` });
        }
        inVlanDef = false;
        currentVlanId = null;
        currentVlanName = undefined;
      }
    }

    // Interface detection
    const ifaceMatch = trimmed.match(/^interface\s+([\w\d/.:\-]+)/i);
    if (ifaceMatch) {
      if (currentInterface) {
        interfaces.push(currentInterface);
      }
      currentInterface = {
        name: ifaceMatch[1],
        mode: 'access',
        status: 'up'
      };
      continue;
    }

    if (currentInterface) {
      if (trimmed.startsWith('description ')) {
        currentInterface.description = trimmed.replace('description ', '').trim();
      } else if (trimmed.startsWith('ip address ')) {
        const parts = trimmed.replace('ip address ', '').trim().split(/\s+/);
        currentInterface.ipAddress = parts[0];
        currentInterface.subnetMask = parts[1] || '255.255.255.0';
      } else if (trimmed.includes('shutdown') && !trimmed.includes('no shutdown') && !trimmed.includes('undo shutdown')) {
        currentInterface.status = 'shutdown';
      } else if (trimmed.includes('port link-type trunk') || trimmed.includes('switchport mode trunk')) {
        currentInterface.mode = 'trunk';
      } else if (trimmed.includes('port link-type hybrid')) {
        currentInterface.mode = 'hybrid';
      } else if (trimmed.includes('port trunk allow-pass vlan') || trimmed.includes('switchport trunk allowed vlan')) {
        const val = trimmed.replace(/port trunk allow-pass vlan|switchport trunk allowed vlan/i, '').trim();
        currentInterface.allowedVlans = val;
      } else if (trimmed.includes('port default vlan') || trimmed.includes('switchport access vlan')) {
        const vlanVal = trimmed.replace(/port default vlan|switchport access vlan/i, '').trim();
        currentInterface.vlan = vlanVal;
        if (!vlans.some(vl => String(vl.id) === String(vlanVal))) {
          vlans.push({ id: vlanVal, name: `VLAN_${vlanVal}` });
        }
      } else if (trimmed.match(/encapsulation dot1Q\s+(\d+)/i)) {
        const vlanMatch = trimmed.match(/encapsulation dot1Q\s+(\d+)/i);
        if (vlanMatch) {
          currentInterface.vlan = vlanMatch[1];
          if (!vlans.some(vl => String(vl.id) === String(vlanMatch[1]))) {
            vlans.push({ id: vlanMatch[1], name: `VLAN_${vlanMatch[1]}` });
          }
        }
      }

      // End of interface block (Huawei '#', Cisco '!' or new interface)
      if (trimmed === '#' || trimmed === '!' || trimmed === 'return' || trimmed === 'end') {
        interfaces.push(currentInterface);
        currentInterface = null;
      }
    }

    // Static Routing
    if (trimmed.startsWith('ip route ') || trimmed.startsWith('ip route-static ')) {
      const details = trimmed;
      routing.push({
        protocol: 'Static',
        details
      });
    }

    // OSPF
    if (trimmed.startsWith('router ospf') || trimmed.startsWith('ospf ')) {
      routing.push({
        protocol: 'OSPF',
        details: trimmed
      });
    }

    // BGP
    if (trimmed.startsWith('router bgp') || trimmed.startsWith('bgp ')) {
      routing.push({
        protocol: 'BGP',
        details: trimmed
      });
    }
  }

  if (currentInterface) {
    interfaces.push(currentInterface);
  }

  // Link SVI / Vlanif IPs to VLAN list
  for (const iface of interfaces) {
    if (iface.name.toLowerCase().startsWith('vlanif') || iface.name.toLowerCase().startsWith('vlan')) {
      const vlanNum = iface.name.replace(/^[^\d]+/i, '');
      const existing = vlans.find(v => String(v.id) === String(vlanNum));
      if (existing) {
        existing.ipAddress = iface.ipAddress;
        existing.subnetMask = iface.subnetMask;
        if (iface.description) existing.name = iface.description;
      } else if (vlanNum) {
        vlans.push({
          id: vlanNum,
          name: iface.description || `VLAN_${vlanNum}`,
          ipAddress: iface.ipAddress,
          subnetMask: iface.subnetMask
        });
      }
    }
  }

  // Determine Device Type
  const hasSubinterfaces = interfaces.some(i => i.name.includes('.'));
  const hasVlanif = interfaces.some(i => i.name.toLowerCase().startsWith('vlanif') || i.name.toLowerCase().startsWith('vlan'));
  const isTrunkSwitch = interfaces.some(i => i.mode === 'trunk');

  if (hostname.toLowerCase().includes('rtr') || hostname.toLowerCase().includes('router') || hasSubinterfaces) {
    deviceType = 'Router';
  } else if (hasVlanif && isTrunkSwitch) {
    deviceType = 'Core Switch';
  } else if (isTrunkSwitch || vlans.length > 0) {
    deviceType = 'Switch';
  }

  return {
    vendor,
    hostname,
    deviceType,
    vlans: vlans.sort((a, b) => Number(a.id) - Number(b.id)),
    interfaces,
    routing,
    acls,
    rawLinesCount: lines.length
  };
}

/**
 * `detailSections` replaces this parser's raw-line routing list and ACL count, so callers that have
 * the core parser's structured routing / NAT / ACL data can render that instead.
 */
export function generateSummaryMarkdown(parsed: ParsedNetworkConfig, lang: 'EN' | 'TH' = 'EN', detailSections?: string): string {
  const isTH = lang === 'TH';

  const vlanListStr = parsed.vlans.length > 0
    ? parsed.vlans.map(v => {
        const ipStr = v.ipAddress ? ` - IP: \`${v.ipAddress}/${maskToCidr(v.subnetMask || '255.255.255.0')}\`` : '';
        const nameStr = v.name ? ` (${v.name})` : '';
        return `  - **VLAN ${v.id}**${nameStr}${ipStr}`;
      }).join('\n')
    : `  - *${isTH ? 'ไม่พบการประกาศ VLAN' : 'No explicit VLANs defined'}*`;

  const trunkInterfaces = parsed.interfaces.filter(i => i.mode === 'trunk');
  const accessInterfaces = parsed.interfaces.filter(i => i.mode === 'access');
  const routedInterfaces = parsed.interfaces.filter(i => i.ipAddress && !i.name.toLowerCase().startsWith('vlan'));

  const routingStr = parsed.routing.length > 0
    ? parsed.routing.map(r => `  - **${r.protocol}**: \`${r.details}\``).join('\n')
    : `  - *${isTH ? 'ไม่มีโปรโตคอล Dynamic Routing (Default / Direct Connected)' : 'Directly Connected / Default Only'}*`;

  if (isTH) {
    return `### สรุปข้อมูล Configuration (Configuration Summary)

- **ชื่ออุปกรณ์ (Device Name):** \`${parsed.hostname}\`
- **ระบบปฏิบัติการ (Vendor / OS):** \`${parsed.vendor}\`
- **ประเภทอุปกรณ์ (Device Type):** ${parsed.deviceType}
- **จำนวนบรรทัด Config:** ${parsed.rawLinesCount} บรรทัด

---

#### 🌐 โครงสร้าง VLAN & Subnet

${vlanListStr}

#### 🔌 ข้อมูลอินเทอร์เฟซ (Interfaces)

- **Trunk Ports (${trunkInterfaces.length}):** ${trunkInterfaces.map(i => `\`${i.name}\``).join(', ') || 'ไม่มี'}
- **Access Ports (${accessInterfaces.length}):** ${accessInterfaces.slice(0, 5).map(i => `\`${i.name}\``).join(', ')}${accessInterfaces.length > 5 ? ' ...' : ''}
- **Routed / L3 Interfaces:** ${routedInterfaces.map(i => `\`${i.name}\` (${i.ipAddress})`).join(', ') || 'ไม่มี'}

${detailSections ?? `#### 🧭 การตั้งค่า Routing

${routingStr}

${parsed.acls.length > 0 ? `#### 🛡️ Access Control Lists (ACLs)\n\n- พบ ${parsed.acls.length} รายการ ACL ป้องกันความปลอดภัย` : ''}`}
`;
  }

  return `### Configuration Summary

- **Device Name:** \`${parsed.hostname}\`
- **Vendor / OS:** \`${parsed.vendor}\`
- **Detected Device Role:** ${parsed.deviceType}
- **Total Config Lines:** ${parsed.rawLinesCount} lines

---

#### 🌐 Active VLANs & Subnets

${vlanListStr}

#### 🔌 Interface Inventory

- **Trunk Ports (${trunkInterfaces.length}):** ${trunkInterfaces.map(i => `\`${i.name}\``).join(', ') || 'None'}
- **Access Ports (${accessInterfaces.length}):** ${accessInterfaces.slice(0, 5).map(i => `\`${i.name}\``).join(', ')}${accessInterfaces.length > 5 ? ' ...' : ''}
- **Routed / L3 Interfaces:** ${routedInterfaces.map(i => `\`${i.name}\` (${i.ipAddress})`).join(', ') || 'None'}

${detailSections ?? `#### 🧭 Routing Protocols

${routingStr}

${parsed.acls.length > 0 ? `#### 🛡️ Security / ACLs\n\n- Found ${parsed.acls.length} ACL entries configured.` : ''}`}
`;
}

function maskToCidr(mask: string): number {
  const parts = mask.split('.').map(Number);
  let cidr = 0;
  for (const part of parts) {
    cidr += (part.toString(2).match(/1/g) || []).length;
  }
  return cidr || 24;
}
