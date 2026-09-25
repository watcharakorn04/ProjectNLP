import type { ExtractedNetworkConfig } from '../core/parser/types';

export type VendorType = 'Cisco IOS' | 'Huawei VRP' | 'Unknown';

export interface VlanInfo {
  id: number | string;
  name?: string;
  interfaces?: string[];
  ipAddress?: string;
  subnetMask?: string;
}

export interface InterfaceInfo {
  name: string;
  description?: string;
  ipAddress?: string;
  subnetMask?: string;
  vlan?: string | number;
  mode?: 'access' | 'trunk' | 'hybrid' | 'routed';
  allowedVlans?: string;
  status?: 'up' | 'shutdown';
}

export interface RoutingProtocol {
  protocol: 'OSPF' | 'BGP' | 'RIP' | 'Static' | 'EIGRP' | 'IS-IS';
  details: string;
  networks?: string[];
  neighbors?: string[];
}

export interface ParsedNetworkConfig {
  vendor: VendorType;
  hostname: string;
  deviceType: 'Switch' | 'Router' | 'Core Switch' | 'Firewall' | 'Unknown Device';
  vlans: VlanInfo[];
  interfaces: InterfaceInfo[];
  routing: RoutingProtocol[];
  acls: string[];
  bannerOrInfo?: string;
  rawLinesCount: number;
}

export interface UploadedConfigFile {
  fileName: string;
  fileSize: string;
  rawContent: string;
  detectedVendor: VendorType;
  parsedData?: ParsedNetworkConfig;
  /** Structured output of the core NetBot parser (`src/core/parser`). */
  extractedConfig?: ExtractedNetworkConfig;
  uploadedAt: string;
}
