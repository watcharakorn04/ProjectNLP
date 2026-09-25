import { VendorType } from '../types/network';

export interface DetectionResult {
  vendor: VendorType;
  confidence: number; // 0 to 100
  matchedKeywords: string[];
  explanation: string;
}

export function detectVendor(content: string): DetectionResult {
  if (!content || content.trim().length === 0) {
    return {
      vendor: 'Unknown',
      confidence: 0,
      matchedKeywords: [],
      explanation: 'Empty or blank configuration file'
    };
  }

  const normalized = content.toLowerCase();

  const huaweiKeywords = [
    { pattern: 'display current-configuration', weight: 35 },
    { pattern: 'sysname ', weight: 25 },
    { pattern: 'vlan batch', weight: 30 },
    { pattern: 'port link-type', weight: 25 },
    { pattern: 'port trunk allow-pass', weight: 25 },
    { pattern: 'port default vlan', weight: 20 },
    { pattern: 'interface vlanif', weight: 25 },
    { pattern: 'ip route-static', weight: 20 },
    { pattern: 'undo ', weight: 15 },
    { pattern: 'user-interface vty', weight: 15 },
    { pattern: 'return\n', weight: 15 },
    { pattern: '#\ninterface', weight: 15 },
    { pattern: 'ospf 1 router-id', weight: 20 },
    { pattern: 'dhcp enable', weight: 15 }
  ];

  const ciscoKeywords = [
    { pattern: 'show running-config', weight: 35 },
    { pattern: 'hostname ', weight: 25 },
    { pattern: 'switchport mode trunk', weight: 25 },
    { pattern: 'switchport mode access', weight: 25 },
    { pattern: 'switchport access vlan', weight: 25 },
    { pattern: 'switchport trunk allowed vlan', weight: 25 },
    { pattern: 'spanning-tree mode', weight: 20 },
    { pattern: 'enable secret', weight: 20 },
    { pattern: 'line vty 0 4', weight: 20 },
    { pattern: 'router ospf', weight: 25 },
    { pattern: 'ip route 0.0.0.0', weight: 20 },
    { pattern: 'no ip domain-lookup', weight: 15 },
    { pattern: 'service password-encryption', weight: 15 },
    { pattern: 'end\n', weight: 15 }
  ];

  let huaweiScore = 0;
  const huaweiMatched: string[] = [];

  for (const item of huaweiKeywords) {
    if (normalized.includes(item.pattern.toLowerCase())) {
      huaweiScore += item.weight;
      huaweiMatched.push(item.pattern.trim());
    }
  }

  let ciscoScore = 0;
  const ciscoMatched: string[] = [];

  for (const item of ciscoKeywords) {
    if (normalized.includes(item.pattern.toLowerCase())) {
      ciscoScore += item.weight;
      ciscoMatched.push(item.pattern.trim());
    }
  }

  if (huaweiScore > ciscoScore && huaweiScore >= 25) {
    const confidence = Math.min(99, Math.round((huaweiScore / (huaweiScore + ciscoScore || 1)) * 100));
    return {
      vendor: 'Huawei VRP',
      confidence,
      matchedKeywords: huaweiMatched,
      explanation: `Detected Huawei VRP syntax: ${huaweiMatched.slice(0, 4).join(', ')}`
    };
  }

  if (ciscoScore > huaweiScore && ciscoScore >= 25) {
    const confidence = Math.min(99, Math.round((ciscoScore / (ciscoScore + huaweiScore || 1)) * 100));
    return {
      vendor: 'Cisco IOS',
      confidence,
      matchedKeywords: ciscoMatched,
      explanation: `Detected Cisco IOS syntax: ${ciscoMatched.slice(0, 4).join(', ')}`
    };
  }

  // Fallback heuristic
  if (normalized.includes('sysname')) {
    return {
      vendor: 'Huawei VRP',
      confidence: 70,
      matchedKeywords: ['sysname'],
      explanation: 'Detected Huawei "sysname" command'
    };
  }

  if (normalized.includes('hostname')) {
    return {
      vendor: 'Cisco IOS',
      confidence: 70,
      matchedKeywords: ['hostname'],
      explanation: 'Detected Cisco "hostname" command'
    };
  }

  return {
    vendor: 'Unknown',
    confidence: 0,
    matchedKeywords: [],
    explanation: 'Could not reliably determine vendor from configuration syntax'
  };
}
