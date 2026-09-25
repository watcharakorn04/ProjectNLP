import { ConfigSection } from './types';

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** Headers that open a new section when the pasted config has lost its indentation. */
const FLAT_SECTION_HEADER_RE =
  /^(interface|vlan\s|router\s|ospf\s|bgp\s|isis\s|rip\s|line\s|user-interface|aaa|hostname|sysname|ip route|ip access-list|access-list|acl\s|ip nat (?:pool|inside source|outside source)|nat address-group|ntp|snmp|logging|banner|version|service\s|dhcp\s|ip domain|ip vpn-instance|vrf\s)/i;

export function isIPv4(value: string | undefined): boolean {
  return !!value && IPV4_RE.test(value);
}

function ipToNumber(ip: string): number {
  return ip.split('.').reduce((n, octet) => ((n << 8) | Number(octet)) >>> 0, 0);
}

/** "0.0.0.255" -> 24; undefined for non-contiguous wildcards such as "0.0.255.0". */
export function wildcardToPrefix(wildcard: string): number | undefined {
  const bits = ipToNumber(wildcard);
  // A contiguous wildcard is 0…01…1, so adding 1 carries through every set bit.
  if (((bits + 1) & bits) !== 0) return undefined;
  return 32 - bits.toString(2).replace(/0/g, '').length;
}

/**
 * Renders an ACL address/wildcard pair as a CIDR prefix when possible, so both vendors' rules read
 * the same way. Huawei allows "0" as shorthand for a host wildcard.
 */
export function formatAclAddress(address: string, wildcard = '0.0.0.0'): string {
  const normalized = wildcard === '0' ? '0.0.0.0' : wildcard;
  if (!isIPv4(normalized)) return address;
  const prefix = wildcardToPrefix(normalized);
  return prefix === undefined ? `${address} ${normalized}` : `${address}/${prefix}`;
}

/** Mask implied by an address's class, used by `network` commands that omit the mask. */
export function classfulMask(address: string): string {
  const first = Number(address.split('.')[0]);
  return prefixToMask(first < 128 ? 8 : first < 192 ? 16 : 24);
}

/** OSPF area in either notation ("0", "0.0.0.0", "0.0.0.10") -> 10. */
export function parseAreaId(value: string): number | undefined {
  if (isIPv4(value)) return ipToNumber(value);
  const id = Number(value);
  return Number.isInteger(id) && id >= 0 ? id : undefined;
}

/** 24 -> "255.255.255.0" */
export function prefixToMask(prefix: number): string {
  const bits = prefix <= 0 ? 0 : (0xffffffff << (32 - Math.min(prefix, 32))) >>> 0;
  return [24, 16, 8, 0].map(shift => (bits >>> shift) & 0xff).join('.');
}

/** ("10.1.1.1", "255.255.255.0") -> "10.1.1.0" */
export function networkAddress(ip: string, mask: string): string {
  const bits = (ipToNumber(ip) & ipToNumber(mask)) >>> 0;
  return [24, 16, 8, 0].map(shift => (bits >>> shift) & 0xff).join('.');
}

/** True when `ip` falls inside `network`/`mask`; used to attach a next hop to its connected subnet. */
export function isInSubnet(ip: string, network: string, mask: string): boolean {
  return isIPv4(ip) && networkAddress(ip, mask) === networkAddress(network, mask);
}

/** "255.255.255.0" -> 24 (counts set bits; assumes a contiguous mask). */
export function maskToPrefix(mask: string): number {
  return mask
    .split('.')
    .reduce((bits, octet) => bits + (Number(octet) >>> 0).toString(2).replace(/0/g, '').length, 0);
}

/** Accepts a dotted mask or a prefix length ("24" / "/24") and returns a dotted mask. */
export function normalizeMask(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (isIPv4(value)) return value;
  const prefix = Number(value.replace(/^\//, ''));
  return Number.isInteger(prefix) && prefix >= 0 && prefix <= 32 ? prefixToMask(prefix) : undefined;
}

export function toVlanId(value: string | undefined): number | undefined {
  const id = Number(value);
  return Number.isInteger(id) && id >= 1 && id <= 4094 ? id : undefined;
}

/**
 * Expands a VLAN list in either vendor syntax into sorted unique IDs.
 *   Cisco:  "10,20,30-35"
 *   Huawei: "10 20 30 to 35"
 */
export function expandVlanList(spec: string): number[] {
  const tokens = spec
    .replace(/\s+to\s+/gi, '-')
    .split(/[\s,]+/)
    .filter(Boolean);

  const ids = new Set<number>();
  for (const token of tokens) {
    const [startRaw, endRaw] = token.split('-');
    const start = toVlanId(startRaw);
    const end = endRaw === undefined ? start : toVlanId(endRaw);
    if (start === undefined || end === undefined) continue;
    for (let id = Math.min(start, end); id <= Math.max(start, end); id++) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

/** [10, 20, 30, 31, 32] -> "10,20,30-32" */
export function compressVlanList(ids: number[]): string {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    ranges.push(start === sorted[i] ? `${start}` : `${start}-${sorted[i]}`);
  }
  return ranges.join(',');
}

/** Normalises an allowed-VLAN spec, preserving the "all" / "none" keywords. */
export function normalizeAllowedVlans(spec: string): string {
  const trimmed = spec.trim().toLowerCase();
  if (trimmed === 'all' || trimmed === 'none') return trimmed;
  return compressVlanList(expandVlanList(trimmed));
}

/** Merges an "add"/"remove" modifier into an existing allowed-VLAN string. */
export function mergeAllowedVlans(current: string | undefined, spec: string, op: 'add' | 'remove'): string {
  const base = current && current !== 'all' && current !== 'none' ? expandVlanList(current) : [];
  const delta = new Set(expandVlanList(spec));
  const merged = op === 'add' ? [...base, ...delta] : base.filter(id => !delta.has(id));
  return compressVlanList(merged);
}

/**
 * Splits raw CLI text into sections: a top-level command followed by its
 * indented sub-commands. `!` (Cisco) and `#` (Huawei) close the current section,
 * except when indented: both vendors print those inside BGP blocks to separate
 * address families, which still belong to the section.
 *
 * If the config has no indentation at all (e.g. mangled by copy/paste), a
 * section only ends at a delimiter or at a recognised top-level header.
 */
export function splitSections(rawConfig: string): ConfigSection[] {
  const lines = rawConfig.replace(/\r\n?/g, '\n').split('\n');
  const hasIndentation = lines.some(line => /^[ \t]+\S/.test(line));
  const sections: ConfigSection[] = [];
  let current: ConfigSection | null = null;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const indented = /^[ \t]/.test(line);

    if (trimmed.startsWith('!') || trimmed === '#') {
      if (!(current && indented)) current = null;
      return;
    }

    const continuesSection = hasIndentation ? indented : !FLAT_SECTION_HEADER_RE.test(trimmed);

    if (current && continuesSection) {
      current.body.push(trimmed);
    } else {
      current = { header: trimmed, body: [], line: index + 1 };
      sections.push(current);
    }
  });

  return sections;
}

export function countLines(rawConfig: string): number {
  return rawConfig.replace(/\r\n?/g, '\n').split('\n').length;
}

/** "interface GigabitEthernet 0/0/1" -> "GigabitEthernet0/0/1"; undefined when the header is not an interface. */
export function interfaceNameFromHeader(header: string): string | undefined {
  const m = header.match(/^interface\s+(\S+)(?:\s+(\d\S*))?/i);
  return m ? m[1] + (m[2] ?? '') : undefined;
}

/** Appends `value` unless it is already present, keeping first-seen order. */
export function pushUnique<T>(list: T[], value: T): void {
  if (!list.includes(value)) list.push(value);
}

/** Drops `undefined` fields so parser output deep-equals fixtures that simply omit them. */
export function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
