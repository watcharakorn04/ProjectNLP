import {
  ConfigSection,
  InterfaceEntry,
  StaticRoute,
  VendorParseResult,
  VlanEntry
} from './types';
import {
  expandVlanList,
  isIPv4,
  mergeAllowedVlans,
  normalizeAllowedVlans,
  normalizeMask,
  splitSections,
  toVlanId
} from './utils';

/** Interfaces that are always Layer 3, regardless of switchport commands. */
const L3_INTERFACE_RE = /^(vlan|vlanif|loopback|tunnel|null|nve|dialer|virtual-template|bdif|eth-trunk\d+\.\d+)/i;

function isLayer3Name(name: string): boolean {
  return L3_INTERFACE_RE.test(name) || name.includes('.');
}

function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

function addVlan(vlans: Map<number, VlanEntry>, vlanId: number, name?: string): void {
  const existing = vlans.get(vlanId);
  if (existing) {
    if (name && !existing.name) existing.name = name;
  } else {
    vlans.set(vlanId, name ? { vlanId, name } : { vlanId });
  }
}

/** Interface state collected while walking a section, before the final mode is resolved. */
interface InterfaceDraft extends Omit<InterfaceEntry, 'mode'> {
  explicitMode?: InterfaceEntry['mode'];
  forcedRouted: boolean;
}

function finalizeInterface(draft: InterfaceDraft, isSwitch: boolean): InterfaceEntry {
  const { explicitMode, forcedRouted, ...rest } = draft;
  let mode: InterfaceEntry['mode'];
  if (forcedRouted || isLayer3Name(draft.name)) mode = 'routed';
  else if (explicitMode) mode = explicitMode;
  else if (draft.ipAddress) mode = 'routed';
  else if (draft.allowedVlans !== undefined) mode = 'trunk';
  else mode = isSwitch ? 'access' : 'routed';

  const entry = stripUndefined<InterfaceEntry>({ ...rest, mode });
  // Access VLAN is meaningless on a trunk / routed port (unless it is a dot1Q sub-interface).
  if (mode === 'trunk' || (mode === 'routed' && !draft.name.includes('.'))) delete entry.vlan;
  if (mode !== 'trunk') {
    delete entry.allowedVlans;
    delete entry.nativeVlan;
  }
  return entry;
}

function parseIpAddress(args: string[], draft: InterfaceDraft): void {
  // Skip secondary addresses and dynamic addressing (dhcp / negotiate / unnumbered).
  if (args.includes('sub') || args.includes('secondary') || !isIPv4(args[0])) return;
  const mask = normalizeMask(args[1]);
  if (!mask) return;
  draft.ipAddress = args[0];
  draft.subnetMask = mask;
}

/**
 * Parses the tail of a static route command after the destination and mask.
 * Grammar (both vendors): [interface] [next-hop] [distance] [keyword value ...]
 */
function parseRouteTail(tokens: string[], stopKeywords: RegExp): Pick<StaticRoute, 'nextHop' | 'outInterface' | 'distance'> | null {
  let nextHop: string | undefined;
  let outInterface: string | undefined;
  let distance: number | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (stopKeywords.test(token)) {
      if (/^preference$/i.test(token)) distance = Number(tokens[i + 1]) || undefined;
      break;
    }
    if (isIPv4(token)) {
      nextHop ??= token;
    } else if (/^\d+$/.test(token)) {
      distance ??= Number(token);
    } else if (!outInterface && !nextHop) {
      outInterface = token;
    }
  }

  const resolvedHop = nextHop ?? outInterface;
  if (!resolvedHop) return null;
  return {
    nextHop: resolvedHop,
    ...(outInterface && { outInterface }),
    ...(distance !== undefined && { distance })
  };
}

// ---------------------------------------------------------------------------
// Cisco IOS / IOS-XE
// ---------------------------------------------------------------------------

function parseCiscoInterface(section: ConfigSection, name: string, vlans: Map<number, VlanEntry>): InterfaceDraft {
  const draft: InterfaceDraft = { name, shutdown: false, forcedRouted: false };

  for (const cmd of section.body) {
    const args = cmd.split(/\s+/);
    let m: RegExpMatchArray | null;

    if ((m = cmd.match(/^description\s+(.+)$/i))) draft.description = m[1];
    else if (/^shutdown$/i.test(cmd)) draft.shutdown = true;
    else if (/^no shutdown$/i.test(cmd)) draft.shutdown = false;
    else if (/^no switchport$/i.test(cmd)) draft.forcedRouted = true;
    else if ((m = cmd.match(/^switchport mode (access|trunk)\b/i))) draft.explicitMode = m[1].toLowerCase() as 'access' | 'trunk';
    else if ((m = cmd.match(/^switchport access vlan (\d+)/i))) {
      draft.vlan = toVlanId(m[1]);
      if (draft.vlan) addVlan(vlans, draft.vlan);
    } else if ((m = cmd.match(/^switchport trunk native vlan (\d+)/i))) draft.nativeVlan = toVlanId(m[1]);
    else if ((m = cmd.match(/^switchport trunk allowed vlan (add|remove) (.+)$/i))) {
      draft.allowedVlans = mergeAllowedVlans(draft.allowedVlans, m[2], m[1].toLowerCase() as 'add' | 'remove');
    } else if ((m = cmd.match(/^switchport trunk allowed vlan (.+)$/i))) draft.allowedVlans = normalizeAllowedVlans(m[1]);
    else if ((m = cmd.match(/^encapsulation dot1q (\d+)/i))) {
      draft.vlan = toVlanId(m[1]);
      if (draft.vlan) addVlan(vlans, draft.vlan);
    } else if (/^ip address\s/i.test(cmd)) parseIpAddress(args.slice(2), draft);
  }

  return draft;
}

function parseCiscoStaticRoute(header: string): StaticRoute | null {
  // ip route [vrf NAME] DEST MASK {NEXT-HOP | INTERFACE [NEXT-HOP]} [AD] [name X] [permanent] [tag N] [track N]
  const tokens = header.split(/\s+/).slice(2);
  let vrf: string | undefined;
  if (tokens[0]?.toLowerCase() === 'vrf') {
    vrf = tokens[1];
    tokens.splice(0, 2);
  }
  const [destination, mask, ...rest] = tokens;
  if (!isIPv4(destination) || !isIPv4(mask)) return null;

  const tail = parseRouteTail(rest, /^(name|permanent|tag|track|global|multicast|dhcp)$/i);
  return tail ? { destination, mask, ...tail, ...(vrf && { vrf }) } : null;
}

export function parseCiscoIos(rawConfig: string): VendorParseResult {
  const sections = splitSections(rawConfig);
  const vlans = new Map<number, VlanEntry>();
  const drafts: InterfaceDraft[] = [];
  const staticRoutes: StaticRoute[] = [];
  let hostname = '';

  for (const section of sections) {
    const { header } = section;
    let m: RegExpMatchArray | null;

    if ((m = header.match(/^hostname\s+(\S+)/i))) {
      hostname = m[1].replace(/^"|"$/g, '');
    } else if ((m = header.match(/^vlan\s+([\d,\-\s]+)$/i))) {
      const name = section.body.map(cmd => cmd.match(/^name\s+(.+)$/i)?.[1]).find(Boolean);
      const ids = expandVlanList(m[1]);
      // A name only makes sense on a single-VLAN definition block.
      ids.forEach(id => addVlan(vlans, id, ids.length === 1 ? name : undefined));
    } else if ((m = header.match(/^interface\s+(\S+)(?:\s+(\d\S*))?/i))) {
      drafts.push(parseCiscoInterface(section, m[1] + (m[2] ?? ''), vlans));
    } else if (/^ip route\s/i.test(header)) {
      const route = parseCiscoStaticRoute(header);
      if (route) staticRoutes.push(route);
    }
  }

  // Decided from the raw text: dot1Q sub-interfaces also populate `vlans` on routers.
  const isSwitch = /^\s*(switchport\b|vlan\s+\d)/im.test(rawConfig);
  return {
    hostname,
    vlans: [...vlans.values()],
    interfaces: drafts.map(d => finalizeInterface(d, isSwitch)),
    staticRoutes
  };
}

// ---------------------------------------------------------------------------
// Huawei VRP
// ---------------------------------------------------------------------------

function parseHuaweiInterface(section: ConfigSection, name: string, vlans: Map<number, VlanEntry>): InterfaceDraft {
  const draft: InterfaceDraft = { name, shutdown: false, forcedRouted: false };

  for (const cmd of section.body) {
    const args = cmd.split(/\s+/);
    let m: RegExpMatchArray | null;

    if ((m = cmd.match(/^description\s+(.+)$/i))) draft.description = m[1];
    else if (/^shutdown$/i.test(cmd)) draft.shutdown = true;
    else if (/^undo shutdown$/i.test(cmd)) draft.shutdown = false;
    else if (/^undo portswitch$/i.test(cmd)) draft.forcedRouted = true;
    // Hybrid ports carry tagged VLANs, so they are reported as trunks.
    else if ((m = cmd.match(/^port link-type (access|trunk|hybrid)\b/i))) {
      draft.explicitMode = m[1].toLowerCase() === 'access' ? 'access' : 'trunk';
    } else if ((m = cmd.match(/^port default vlan (\d+)/i))) {
      draft.vlan = toVlanId(m[1]);
      if (draft.vlan) addVlan(vlans, draft.vlan);
    } else if ((m = cmd.match(/^port (?:trunk|hybrid) pvid vlan (\d+)/i))) draft.nativeVlan = toVlanId(m[1]);
    else if ((m = cmd.match(/^port (?:trunk allow-pass|hybrid tagged) vlan (.+)$/i))) {
      // Huawei accumulates repeated allow-pass lines rather than replacing them.
      draft.allowedVlans = /^all$/i.test(m[1].trim())
        ? 'all'
        : mergeAllowedVlans(draft.allowedVlans, m[1], 'add');
    } else if ((m = cmd.match(/^(?:dot1q termination vid|vlan-type dot1q)\s+(\d+)/i))) {
      draft.vlan = toVlanId(m[1]);
      if (draft.vlan) addVlan(vlans, draft.vlan);
    } else if (/^ip address\s/i.test(cmd)) parseIpAddress(args.slice(2), draft);
  }

  return draft;
}

function parseHuaweiStaticRoute(header: string): StaticRoute | null {
  // ip route-static [vpn-instance NAME] DEST {MASK | LEN} {INTERFACE [NEXT-HOP] | NEXT-HOP} [preference N] [description X]
  const tokens = header.split(/\s+/).slice(2);
  let vrf: string | undefined;
  if (tokens[0]?.toLowerCase() === 'vpn-instance') {
    vrf = tokens[1];
    tokens.splice(0, 2);
  }
  const [destination, rawMask, ...rest] = tokens;
  const mask = normalizeMask(rawMask);
  if (!isIPv4(destination) || !mask) return null;

  const tail = parseRouteTail(rest, /^(preference|description|tag|track|bfd|permanent|inherit-cost|no-advertise)$/i);
  return tail ? { destination, mask, ...tail, ...(vrf && { vrf }) } : null;
}

export function parseHuaweiVrp(rawConfig: string): VendorParseResult {
  const sections = splitSections(rawConfig);
  const vlans = new Map<number, VlanEntry>();
  const drafts: InterfaceDraft[] = [];
  const staticRoutes: StaticRoute[] = [];
  let hostname = '';

  for (const section of sections) {
    const { header } = section;
    let m: RegExpMatchArray | null;

    if ((m = header.match(/^sysname\s+(\S+)/i))) {
      hostname = m[1];
    } else if ((m = header.match(/^vlan batch\s+(.+)$/i))) {
      expandVlanList(m[1]).forEach(id => addVlan(vlans, id));
    } else if ((m = header.match(/^vlan\s+(\d+)$/i))) {
      const id = toVlanId(m[1]);
      const name =
        section.body.map(cmd => cmd.match(/^name\s+(.+)$/i)?.[1]).find(Boolean) ??
        section.body.map(cmd => cmd.match(/^description\s+(.+)$/i)?.[1]).find(Boolean);
      if (id) addVlan(vlans, id, name);
    } else if ((m = header.match(/^interface\s+(\S+)(?:\s+(\d\S*))?/i))) {
      drafts.push(parseHuaweiInterface(section, m[1] + (m[2] ?? ''), vlans));
    } else if (/^ip route-static\s/i.test(header)) {
      const route = parseHuaweiStaticRoute(header);
      if (route) staticRoutes.push(route);
    }
  }

  const isSwitch = /^\s*(port link-type|port default vlan|vlan batch|vlan\s+\d)/im.test(rawConfig);
  return {
    hostname,
    vlans: [...vlans.values()],
    interfaces: drafts.map(d => finalizeInterface(d, isSwitch)),
    staticRoutes
  };
}
