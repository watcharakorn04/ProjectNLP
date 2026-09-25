import { ConfigSection, DynamicNatRule, NatConfig, NatPool, StaticNatRule } from './types';
import { interfaceNameFromHeader, isIPv4, normalizeMask, pushUnique, stripUndefined } from './utils';

function emptyNat(): NatConfig {
  return { insideInterfaces: [], outsideInterfaces: [], pools: [], rules: [] };
}

// ---------------------------------------------------------------------------
// Cisco IOS
// ---------------------------------------------------------------------------

function parseCiscoPool(header: string): NatPool | null {
  const m = header.match(/^ip nat pool\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(?:netmask\s+(\S+)|prefix-length\s+(\d+)))?/i);
  if (!m || !isIPv4(m[2]) || !isIPv4(m[3])) return null;
  return stripUndefined<NatPool>({
    name: m[1],
    startAddress: m[2],
    endAddress: m[3],
    subnetMask: normalizeMask(m[4] ?? m[5])
  });
}

/** `static [tcp|udp] LOCAL [LPORT] {GLOBAL | interface IF} [GPORT] [extendable]` */
function parseCiscoStatic(direction: StaticNatRule['direction'], tokens: string[]): StaticNatRule | null {
  let i = 0;
  const protocol = /^(tcp|udp)$/i.test(tokens[0] ?? '') ? tokens[i++].toLowerCase() : undefined;
  const localAddress = tokens[i++];
  if (!isIPv4(localAddress)) return null;
  const localPort = protocol ? tokens[i++] : undefined;

  let globalAddress: string | undefined;
  let iface: string | undefined;
  if (tokens[i]?.toLowerCase() === 'interface') {
    iface = tokens[i + 1];
    i += 2;
  } else {
    globalAddress = tokens[i++];
    if (!isIPv4(globalAddress)) return null;
  }
  if (!globalAddress && !iface) return null;

  return stripUndefined<StaticNatRule>({
    type: 'static',
    direction,
    protocol,
    localAddress,
    localPort,
    globalAddress,
    globalPort: protocol ? tokens[i] : undefined,
    interface: iface
  });
}

/** `ACL {pool NAME | interface IF} [overload]` (the tokens after `list`). */
function parseCiscoDynamic(direction: DynamicNatRule['direction'], tokens: string[]): DynamicNatRule | null {
  const lower = tokens.map(t => t.toLowerCase());
  const acl = tokens[0];
  if (!acl) return null;
  const at = (keyword: string) => (lower.includes(keyword) ? tokens[lower.indexOf(keyword) + 1] : undefined);

  return stripUndefined<DynamicNatRule>({
    type: 'dynamic',
    direction,
    acl,
    pool: at('pool'),
    interface: at('interface'),
    overload: lower.includes('overload')
  });
}

/** `ip nat inside|outside` interface roles, `ip nat pool` and `ip nat inside|outside source static|list` rules. */
export function parseCiscoNat(sections: ConfigSection[]): NatConfig {
  const nat = emptyNat();

  for (const { header, body } of sections) {
    const ifaceName = interfaceNameFromHeader(header);
    if (ifaceName) {
      if (body.some(cmd => /^ip nat inside$/i.test(cmd))) pushUnique(nat.insideInterfaces, ifaceName);
      if (body.some(cmd => /^ip nat outside$/i.test(cmd))) pushUnique(nat.outsideInterfaces, ifaceName);
      continue;
    }

    let m: RegExpMatchArray | null;
    if (/^ip nat pool\s/i.test(header)) {
      const pool = parseCiscoPool(header);
      if (pool) nat.pools.push(pool);
    } else if ((m = header.match(/^ip nat (inside|outside) source\s+(static|list)\s+(.+)$/i))) {
      const direction = m[1].toLowerCase() as 'inside' | 'outside';
      const tokens = m[3].split(/\s+/);
      const rule =
        m[2].toLowerCase() === 'static'
          ? parseCiscoStatic(direction, tokens)
          : parseCiscoDynamic(direction, tokens);
      if (rule) nat.rules.push(rule);
    }
  }

  return nat;
}

// ---------------------------------------------------------------------------
// Huawei VRP
// ---------------------------------------------------------------------------

/** Keywords that can follow an address in `nat static` / `nat server`, so they are never read as a port. */
const HUAWEI_NAT_KEYWORD_RE = /^(global|inside|netmask|vpn-instance|no-reverse|description|unr-route|reversible|protocol)$/i;

/** Older `nat address-group N START END`, or newer `nat address-group N` with a `section ID START END` line. */
function parseHuaweiAddressGroup(header: string, body: string[]): NatPool | null {
  const m = header.match(/^nat address-group\s+(\S+)(.*)$/i);
  if (!m) return null;
  const inline = m[2].split(/\s+/).filter(isIPv4);
  const section = body.map(cmd => cmd.match(/^section\s+\d+\s+(\S+)\s+(\S+)/i)).find(Boolean);
  const [startAddress, endAddress] = inline.length >= 2 ? inline : section ? [section[1], section[2]] : [];
  if (!isIPv4(startAddress) || !isIPv4(endAddress)) return null;
  return { name: m[1], startAddress, endAddress };
}

/**
 * `nat static [protocol P] global G [GP] inside L [LP] ...` and
 * `nat server [protocol P] global {G | current-interface | interface IF} [GP] inside L [LP] ...`.
 * `nat server` publishes an inside host, which is a static mapping as far as the summary is concerned.
 */
function parseHuaweiStatic(cmd: string, configuredOn: string | undefined): StaticNatRule | null {
  const tokens = cmd.split(/\s+/).slice(2);
  const lower = tokens.map(t => t.toLowerCase());
  const protocolAt = lower.indexOf('protocol');
  const protocol = protocolAt >= 0 ? lower[protocolAt + 1] : undefined;
  const portAt = (i: number) =>
    protocol && tokens[i] && !HUAWEI_NAT_KEYWORD_RE.test(tokens[i]) && !isIPv4(tokens[i]) ? tokens[i] : undefined;

  let i = lower.indexOf('global') + 1;
  if (i === 0) return null;
  let globalAddress: string | undefined;
  let iface = configuredOn;
  if (lower[i] === 'current-interface') {
    i += 1;
  } else if (lower[i] === 'interface') {
    iface = tokens[i + 1];
    i += 2;
  } else if (isIPv4(tokens[i])) {
    globalAddress = tokens[i++];
  } else {
    return null;
  }
  const globalPort = portAt(i);

  const insideAt = lower.indexOf('inside', i);
  const localAddress = tokens[insideAt + 1];
  if (insideAt < 0 || !isIPv4(localAddress)) return null;

  return stripUndefined<StaticNatRule>({
    type: 'static',
    direction: 'inside',
    protocol,
    localAddress,
    localPort: portAt(insideAt + 2),
    globalAddress,
    globalPort,
    interface: iface
  });
}

/** `nat outbound ACL [address-group G] [no-pat]`; without an address group it is Easy IP (the interface address). */
function parseHuaweiOutbound(cmd: string, iface: string): DynamicNatRule | null {
  const m = cmd.match(/^nat outbound\s+(\S+)(.*)$/i);
  if (!m) return null;
  const pool = m[2].match(/\baddress-group\s+(\S+)/i)?.[1];
  return stripUndefined<DynamicNatRule>({
    type: 'dynamic',
    direction: 'inside',
    acl: m[1],
    pool,
    interface: iface,
    overload: !/\bno-pat\b/i.test(m[2])
  });
}

/** `nat address-group` pools, interface `nat outbound` / `nat static` / `nat server`, and global static mappings. */
export function parseHuaweiNat(sections: ConfigSection[]): NatConfig {
  const nat = emptyNat();

  for (const { header, body } of sections) {
    const ifaceName = interfaceNameFromHeader(header);
    if (ifaceName) {
      for (const cmd of body) {
        const rule = /^nat outbound\s/i.test(cmd)
          ? parseHuaweiOutbound(cmd, ifaceName)
          : /^nat (static|server)\s/i.test(cmd)
            ? parseHuaweiStatic(cmd, ifaceName)
            : null;
        if (rule) {
          nat.rules.push(rule);
          pushUnique(nat.outsideInterfaces, ifaceName);
        }
      }
      continue;
    }

    if (/^nat address-group\s/i.test(header)) {
      const pool = parseHuaweiAddressGroup(header, body);
      if (pool) nat.pools.push(pool);
    } else if (/^nat (static|server)\s/i.test(header)) {
      const rule = parseHuaweiStatic(header, undefined);
      if (rule) nat.rules.push(rule);
    }
  }

  return nat;
}
