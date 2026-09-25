import {
  AccessList,
  BgpProcess,
  ExtractedNetworkConfig,
  NatConfig,
  NatRule,
  OspfProcess,
  StaticRoute,
  SupportedVendor
} from './types';
import { formatAclAddress, isIPv4, maskToPrefix } from './utils';

/**
 * Offline answers to feature questions ("show the static routes", "ACL", "NAT rules", "BGP neighbors")
 * rendered as Markdown tables straight from `ExtractedNetworkConfig`, so the rule engine can answer
 * them in detail without an LLM.
 */

export type FeatureTopic = 'staticRoutes' | 'acl' | 'nat' | 'ospf' | 'bgp';

/** Output order when a question touches several topics. */
export const FEATURE_TOPICS: readonly FeatureTopic[] = ['staticRoutes', 'ospf', 'bgp', 'nat', 'acl'];

/** Table rows per section (per ACL for ACLs), so a large config stays readable in chat. */
export const MAX_TABLE_ROWS = 30;

const TOPIC_PATTERNS: Record<FeatureTopic, RegExp> = {
  staticRoutes: /\bstatic[\s-]+rout|\bdefault[\s-]+rout|\bip\s+route\b|\broute-static\b/i,
  acl: /\bacls?\b|\baccess[\s-]*(?:lists?|groups?)\b|\bfirewall\s+rules?\b/i,
  nat: /\bnat\b|\bpat\b|address\s+translation|port[\s-]+forward|\baddress-group\b|แปลง\s*(?:ที่อยู่|address|ip)/i,
  ospf: /\bospf\b/i,
  bgp: /\b[ei]?bgp\b/i
};

const ROUTING_TOPICS: readonly FeatureTopic[] = ['staticRoutes', 'ospf', 'bgp'];
/** Generic routing questions ("show the routing table", "เส้นทาง") that name no specific routing feature. */
const GENERIC_ROUTING_PATTERN = /\brout(?:e|es|ing)\b|เส้นทาง|เราต์ติ้ง/i;

/**
 * Feature topics a free-text question asks about, in `FEATURE_TOPICS` order. Uses word boundaries so
 * "nat" does not match "destination" and "route" does not match "router".
 */
export function detectFeatureTopics(prompt: string): FeatureTopic[] {
  const found = new Set(FEATURE_TOPICS.filter(topic => TOPIC_PATTERNS[topic].test(prompt)));
  if (!ROUTING_TOPICS.some(topic => found.has(topic)) && GENERIC_ROUTING_PATTERN.test(prompt)) {
    ROUTING_TOPICS.forEach(topic => found.add(topic));
  }
  return FEATURE_TOPICS.filter(topic => found.has(topic));
}

/** Markdown table cell: pipes and line breaks would split the row. */
const cell = (text: string | number) => String(text).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const code = (text: string | number) => `\`${cell(text).replace(/`/g, "'")}\``;
const DASH = '-';

function table(headers: string[], rows: string[][], isTH: boolean): string {
  const hidden = rows.length - MAX_TABLE_ROWS;
  const body = rows
    .slice(0, MAX_TABLE_ROWS)
    .map(row => `| ${row.join(' | ')} |`)
    .join('\n');
  const note = hidden > 0 ? `\n\n*${isTH ? `…และอีก ${hidden} แถว` : `…and ${hidden} more rows`}*` : '';
  return `| ${headers.join(' | ')} |\n|${headers.map(() => '---').join('|')}|\n${body}${note}`;
}

const none = (text: string) => `*${text}*`;

/** Administrative distance the vendor applies when a static route does not set one. */
const defaultDistance = (vendor: SupportedVendor) => (vendor === 'Huawei VRP' ? 60 : 1);

function staticRoutesSection(config: ExtractedNetworkConfig, isTH: boolean): string {
  const routes = config.staticRoutes;
  const heading = `#### 🧭 Static Routes (${routes.length})`;
  if (!routes.length) return `${heading}\n\n${none(isTH ? 'ไม่พบ static route ใน config' : 'No static routes are configured.')}`;

  const rows = routes.map((route: StaticRoute) => {
    const prefix = maskToPrefix(route.mask);
    const hasNextHopIp = isIPv4(route.nextHop);
    const exit = route.outInterface ?? (hasNextHopIp ? undefined : route.nextHop);
    const destination = `${code(`${route.destination}/${prefix}`)}${prefix === 0 ? ' (default)' : ''}`;
    const exitText = exit ? `${code(exit)}${/^null/i.test(exit) ? ' (discard)' : ''}` : DASH;
    const distance = route.distance ?? `${defaultDistance(config.vendor)} (default)`;
    return [destination, hasNextHopIp ? code(route.nextHop) : DASH, exitText, cell(distance), route.vrf ? code(route.vrf) : DASH];
  });
  return `${heading}\n\n${table(['Destination', 'Next hop', 'Exit interface', 'AD / Preference', 'VRF'], rows, isTH)}`;
}

const areaText = (area: number) => (area === 0 ? '0 (backbone)' : String(area));

function ospfProcessBlock(process: OspfProcess, isTH: boolean): string {
  const facts = [
    process.routerId && `router-id ${code(process.routerId)}`,
    process.vrf && `VRF ${code(process.vrf)}`,
    process.redistribute.length && `redistribute ${process.redistribute.map(code).join(', ')}`,
    process.defaultOriginate && (isTH ? 'ประกาศ default route' : 'originates a default route')
  ].filter(Boolean);
  const title = `**OSPF ${process.processId}**${facts.length ? ` — ${facts.join(' • ')}` : ''}`;
  const rows = [
    ...process.networks.map(n => ['network', code(formatAclAddress(n.address, n.wildcard)), areaText(n.area)]),
    ...process.interfaces.map(i => ['interface', code(i.name), areaText(i.area)])
  ];
  if (!rows.length) return `${title}\n\n${none(isTH ? 'ยังไม่มี network / interface ใน process นี้' : 'No networks or interfaces are enabled in this process.')}`;
  return `${title}\n\n${table(['Type', 'Network / Interface', 'Area'], rows, isTH)}`;
}

function bgpProcessBlock(process: BgpProcess, isTH: boolean): string {
  const facts = [
    process.routerId && `router-id ${code(process.routerId)}`,
    process.redistribute.length && `redistribute ${process.redistribute.map(code).join(', ')}`
  ].filter(Boolean);
  const title = `**BGP AS ${process.asNumber}**${facts.length ? ` — ${facts.join(' • ')}` : ''}`;
  const parts = [title];

  if (process.neighbors.length) {
    const rows = process.neighbors.map(n => [
      code(n.address),
      n.remoteAs ? code(n.remoteAs) : DASH,
      n.remoteAs ? (n.remoteAs === process.asNumber ? 'iBGP' : 'eBGP') : DASH,
      n.description ? cell(n.description) : DASH
    ]);
    parts.push(table(['Neighbor', 'Remote AS', 'Session', 'Description'], rows, isTH));
  } else {
    parts.push(none(isTH ? 'ไม่พบ BGP neighbor' : 'No BGP neighbors are configured.'));
  }
  if (process.networks.length) {
    const networks = process.networks.map(n => code(`${n.address}/${maskToPrefix(n.mask)}`)).join(', ');
    parts.push(`${isTH ? '**Network ที่ประกาศ:**' : '**Advertised networks:**'} ${networks}`);
  }
  return parts.join('\n\n');
}

function ospfSection(config: ExtractedNetworkConfig, isTH: boolean): string {
  const processes = config.routingProcesses.filter((p): p is OspfProcess => p.protocol === 'ospf');
  const body = processes.length
    ? processes.map(p => ospfProcessBlock(p, isTH)).join('\n\n')
    : none(isTH ? 'ไม่พบ OSPF process ใน config' : 'No OSPF process is configured.');
  return `#### 🛰️ OSPF\n\n${body}`;
}

function bgpSection(config: ExtractedNetworkConfig, isTH: boolean): string {
  const processes = config.routingProcesses.filter((p): p is BgpProcess => p.protocol === 'bgp');
  const body = processes.length
    ? processes.map(p => bgpProcessBlock(p, isTH)).join('\n\n')
    : none(isTH ? 'ไม่พบ BGP ใน config' : 'No BGP process is configured.');
  return `#### 🌍 BGP\n\n${body}`;
}

const withPort = (host: string, port?: string) => (port ? `${host}:${port}` : host);

/** Permitted sources of the ACL a dynamic NAT rule uses, i.e. which hosts get translated. */
function aclSources(acls: AccessList[], name: string): string {
  const acl = acls.find(a => a.name === name);
  if (!acl) return '';
  const sources = acl.rules.filter(r => r.action === 'permit').map(r => r.source);
  const shown = sources.slice(0, 3).map(code).join(', ');
  return shown ? ` (${shown}${sources.length > 3 ? ', …' : ''})` : '';
}

function natRuleRow(rule: NatRule, nat: NatConfig, acls: AccessList[], isTH: boolean): string[] {
  const on = (iface?: string) => (iface ? ` ${isTH ? 'บน' : 'on'} ${code(iface)}` : '');
  const ipOf = (iface: string) => `${isTH ? 'IP ของ' : 'address of'} ${code(iface)}`;

  if (rule.type === 'dynamic') {
    const pool = rule.pool ? nat.pools.find(p => p.name === rule.pool) : undefined;
    const target = rule.pool
      ? `pool ${code(rule.pool)}${pool ? ` (${pool.startAddress} – ${pool.endAddress})` : ''}${on(rule.interface)}`
      : ipOf(rule.interface ?? '?');
    return [rule.overload ? 'PAT' : 'Dynamic NAT', rule.direction, `ACL ${code(rule.acl)}${aclSources(acls, rule.acl)}`, target];
  }

  const global = rule.globalAddress
    ? `${code(withPort(rule.globalAddress, rule.globalPort))}${on(rule.interface)}`
    : `${ipOf(rule.interface ?? '?')}${rule.globalPort ? ` : ${code(rule.globalPort)}` : ''}`;
  return [`Static NAT${rule.protocol ? ` (${rule.protocol})` : ''}`, rule.direction, code(withPort(rule.localAddress, rule.localPort)), global];
}

function natSection(config: ExtractedNetworkConfig, isTH: boolean): string {
  const { nat, accessLists } = config;
  const heading = `#### 🔁 NAT (${nat.rules.length} ${nat.rules.length === 1 ? 'rule' : 'rules'})`;
  if (!nat.rules.length && !nat.pools.length) {
    return `${heading}\n\n${none(isTH ? 'ไม่พบการตั้งค่า NAT ใน config' : 'No NAT is configured.')}`;
  }

  const parts = [heading];
  const roles = [
    nat.insideInterfaces.length && `**Inside:** ${nat.insideInterfaces.map(code).join(', ')}`,
    nat.outsideInterfaces.length && `**Outside:** ${nat.outsideInterfaces.map(code).join(', ')}`
  ].filter(Boolean);
  if (roles.length) parts.push(`- ${roles.join(' • ')}`);
  if (nat.pools.length) {
    const rows = nat.pools.map(p => [code(p.name), code(p.startAddress), code(p.endAddress), p.subnetMask ? code(p.subnetMask) : DASH]);
    parts.push(`**${isTH ? 'Address pool' : 'Address pools'}**\n\n${table(['Pool', 'Start', 'End', 'Mask'], rows, isTH)}`);
  }
  if (nat.rules.length) {
    const rows = nat.rules.map(rule => natRuleRow(rule, nat, accessLists, isTH));
    parts.push(`**${isTH ? 'NAT rule' : 'Translation rules'}**\n\n${table(['Type', 'Direction', 'Local (matched)', 'Global (translated to)'], rows, isTH)}`);
  }
  return parts.join('\n\n');
}

function aclBlock(acl: AccessList, config: ExtractedNetworkConfig, isTH: boolean): string {
  const usedByNat = config.nat.rules.some(r => r.type === 'dynamic' && r.acl === acl.name);
  const count = acl.rules.length;
  const facts = [
    acl.type,
    isTH ? `${count} rule` : `${count} ${count === 1 ? 'rule' : 'rules'}`,
    usedByNat && (isTH ? 'ใช้เลือก traffic สำหรับ NAT' : 'selects traffic for NAT')
  ].filter(Boolean);
  const title = `**ACL ${code(acl.name)}** — ${facts.join(' • ')}`;
  if (!count) return `${title}\n\n${none(isTH ? 'ACL นี้ยังไม่มี rule' : 'This ACL has no rules.')}`;

  const rows = acl.rules.map(r => [
    r.sequence !== undefined ? String(r.sequence) : DASH,
    r.action === 'permit' ? '✅ permit' : '⛔ deny',
    cell(r.protocol),
    code(r.sourcePort ? `${r.source} ${r.sourcePort}` : r.source),
    code(r.destinationPort ? `${r.destination} ${r.destinationPort}` : r.destination)
  ]);
  return `${title}\n\n${table(['Seq', 'Action', 'Protocol', 'Source', 'Destination'], rows, isTH)}`;
}

function aclSection(config: ExtractedNetworkConfig, isTH: boolean): string {
  const acls = config.accessLists;
  const heading = `#### 🛡️ Access Control Lists (${acls.length})`;
  const body = acls.length
    ? acls.map(acl => aclBlock(acl, config, isTH)).join('\n\n')
    : none(isTH ? 'ไม่พบ ACL ใน config' : 'No ACLs are configured.');
  return `${heading}\n\n${body}`;
}

const SECTION_BUILDERS: Record<FeatureTopic, (config: ExtractedNetworkConfig, isTH: boolean) => string> = {
  staticRoutes: staticRoutesSection,
  ospf: ospfSection,
  bgp: bgpSection,
  nat: natSection,
  acl: aclSection
};

/**
 * Markdown reply for the requested feature topics: one section per topic with tables of the parsed
 * static routes, OSPF / BGP processes, NAT rules or ACLs. A topic the config lacks says so explicitly,
 * so the user can tell "not configured" apart from "not understood".
 */
export function describeFeatureTopics(config: ExtractedNetworkConfig, topics: readonly FeatureTopic[], isTH: boolean): string {
  const heading = isTH
    ? `### 🔍 รายละเอียดจาก Config ของ ${config.hostname} (${config.vendor})`
    : `### 🔍 Parsed details for ${config.hostname} (${config.vendor})`;
  const sections = FEATURE_TOPICS.filter(topic => topics.includes(topic)).map(topic => SECTION_BUILDERS[topic](config, isTH));
  return [heading, ...sections].join('\n\n');
}
