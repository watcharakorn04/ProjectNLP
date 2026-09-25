/**
 * Core types for the NetBot CLI parser engine.
 *
 * `ExtractedNetworkConfig` is the vendor-neutral output of `parseNetworkConfig()`.
 * It is intentionally separate from the legacy UI-facing `ParsedNetworkConfig`
 * in `src/types/network.ts`, which the diagram generator and prompt builder still consume.
 */

/** Short vendor hint accepted by `parseNetworkConfig()`. */
export type VendorHint = 'Cisco' | 'Huawei';

/** Vendors the core engine can parse. */
export type SupportedVendor = 'Cisco IOS' | 'Huawei VRP';

export type InterfaceMode = 'access' | 'trunk' | 'routed';

export interface VlanEntry {
  vlanId: number;
  name?: string;
}

export interface InterfaceEntry {
  name: string;
  mode: InterfaceMode;
  /** Access VLAN (access ports) or dot1Q VLAN (routed sub-interfaces). */
  vlan?: number;
  /** Normalised allowed-VLAN list for trunks, e.g. "10,20,30-35", "all" or "none". */
  allowedVlans?: string;
  /** Native / PVID VLAN on trunk ports. */
  nativeVlan?: number;
  ipAddress?: string;
  /** Dotted-decimal mask (Huawei prefix lengths are converted). */
  subnetMask?: string;
  description?: string;
  shutdown: boolean;
}

export interface SviGateway {
  interfaceName: string;
  ipAddress: string;
  subnetMask: string;
  vlanId: number;
  /** `svi` = Vlan/Vlanif interface, `subinterface` = 802.1Q router sub-interface (router-on-a-stick). */
  kind: 'svi' | 'subinterface';
}

export interface StaticRoute {
  destination: string;
  mask: string;
  /** Next-hop IP, or the exit interface when the route has no next-hop IP. */
  nextHop: string;
  outInterface?: string;
  distance?: number;
  vrf?: string;
}

export interface ParseMeta {
  detectedBy: 'hint' | 'auto';
  /** Detection confidence 0–100 (100 when a hint was supplied). */
  confidence: number;
  lineCount: number;
  warnings: string[];
}

export interface ExtractedNetworkConfig {
  hostname: string;
  vendor: SupportedVendor;
  vlans: VlanEntry[];
  interfaces: InterfaceEntry[];
  sviGateways: SviGateway[];
  staticRoutes: StaticRoute[];
  meta: ParseMeta;
}

/** A top-level config command plus its indented sub-commands. */
export interface ConfigSection {
  header: string;
  body: string[];
  /** 1-based line number of the header in the raw config. */
  line: number;
}

/** What a vendor-specific parser produces before shared post-processing. */
export type VendorParseResult = Omit<ExtractedNetworkConfig, 'vendor' | 'sviGateways' | 'meta'>;
