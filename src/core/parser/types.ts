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

/**
 * Cisco "standard" / Huawei "basic" ACLs match the source only; Cisco "extended" / Huawei "advanced"
 * ACLs also match protocol, destination and ports.
 */
export type AclType = 'standard' | 'extended';

export interface AclRule {
  /** Cisco sequence number or Huawei rule ID, when the config states one. */
  sequence?: number;
  action: 'permit' | 'deny';
  /** `ip` for standard/basic ACLs. */
  protocol: string;
  /** `any`, a CIDR prefix (`10.0.0.0/24`, `10.0.0.5/32`), `address wildcard` when the wildcard is non-contiguous, or `object-group NAME`. */
  source: string;
  sourcePort?: string;
  /** Same format as `source`; always `any` for standard/basic ACLs. */
  destination: string;
  /** Port match such as `eq 22` or `range 1000 2000`. */
  destinationPort?: string;
}

export interface AccessList {
  /** Number or name, e.g. "10", "NAT_USERS", "3000". */
  name: string;
  type: AclType;
  rules: AclRule[];
}

export interface StaticNatRule {
  type: 'static';
  /** Cisco `ip nat inside|outside source`; Huawei NAT is always reported as `inside`. */
  direction: 'inside' | 'outside';
  /** Set for port mappings (`tcp` / `udp`). */
  protocol?: string;
  localAddress: string;
  localPort?: string;
  /** Omitted when the global side is an interface address. */
  globalAddress?: string;
  globalPort?: string;
  /** Interface whose address is the global side, or (Huawei) the interface the rule is configured on. */
  interface?: string;
}

export interface DynamicNatRule {
  type: 'dynamic';
  direction: 'inside' | 'outside';
  /** ACL that selects the traffic to translate. */
  acl: string;
  /** Address pool (Cisco `ip nat pool`, Huawei `nat address-group`). Omitted when translating to an interface address. */
  pool?: string;
  /** Interface whose address is used (Cisco `interface X`, Huawei Easy IP), or where the Huawei rule is configured. */
  interface?: string;
  /** Port address translation (Cisco `overload`; Huawei unless `no-pat`). */
  overload: boolean;
}

export type NatRule = StaticNatRule | DynamicNatRule;

export interface NatPool {
  name: string;
  startAddress: string;
  endAddress: string;
  subnetMask?: string;
}

export interface NatConfig {
  /** Cisco `ip nat inside` interfaces. Huawei has no equivalent marking. */
  insideInterfaces: string[];
  /** Cisco `ip nat outside` interfaces, and Huawei interfaces carrying NAT rules. */
  outsideInterfaces: string[];
  pools: NatPool[];
  rules: NatRule[];
}

export interface OspfNetwork {
  address: string;
  wildcard: string;
  /** Area ID as a number (Huawei's dotted `0.0.0.0` is converted). */
  area: number;
}

export interface OspfProcess {
  protocol: 'ospf';
  processId: number;
  routerId?: string;
  vrf?: string;
  networks: OspfNetwork[];
  /** Interfaces enabled directly (Cisco `ip ospf <pid> area <a>`, Huawei `ospf enable <pid> area <a>`). */
  interfaces: { name: string; area: number }[];
  /** Redistributed sources, normalised across vendors: `connected`, `static`, `ospf 2`, `bgp 65001`… */
  redistribute: string[];
  /** Cisco `default-information originate` / Huawei `default-route-advertise`. */
  defaultOriginate: boolean;
}

export interface BgpNeighbor {
  address: string;
  /** Own `remote-as` / `as-number`, or the one inherited from its peer group. */
  remoteAs?: string;
  description?: string;
}

export interface BgpProcess {
  protocol: 'bgp';
  /** Kept as a string so asdot notation ("65000.10") survives. */
  asNumber: string;
  routerId?: string;
  neighbors: BgpNeighbor[];
  /** Advertised IPv4 unicast networks; the classful mask is used when none is given. */
  networks: { address: string; mask: string }[];
  redistribute: string[];
}

export type RoutingProcess = OspfProcess | BgpProcess;

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
  accessLists: AccessList[];
  nat: NatConfig;
  routingProcesses: RoutingProcess[];
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
