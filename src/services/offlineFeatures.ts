import { formatAclAddress, maskToPrefix } from '../core/parser';
import type { AclRule, ExtractedNetworkConfig, NatRule, RoutingProcess, StaticRoute } from '../core/parser';

/**
 * Routing, NAT and ACL sections for offline replies, built from the core parser's structured output
 * because the legacy `ParsedNetworkConfig` only keeps raw routing lines and an ACL count.
 */

/** Items listed per line before "and N more", so long configs stay readable in chat. */
const MAX_LISTED_ITEMS = 8;
/** ACL table rows across all lists. */
export const MAX_ACL_ROWS = 15;

const code = (text: string) => `\`${text}\``;

function listWithMore(items: string[], isTH: boolean): string {
  const more = items.length - MAX_LISTED_ITEMS;
  const shown = items.slice(0, MAX_LISTED_ITEMS).join(', ');
  return more > 0 ? `${shown} ${isTH ? `และอีก ${more} รายการ` : `and ${more} more`}` : shown;
}

function describeStaticRoute(route: StaticRoute): string {
  const hop =
    route.outInterface && route.outInterface !== route.nextHop ? `${route.nextHop} via ${route.outInterface}` : route.nextHop;
  const extras = [route.distance !== undefined && `AD ${route.distance}`, route.vrf && `VRF ${route.vrf}`].filter(Boolean);
  return code(`${route.destination}/${maskToPrefix(route.mask)} → ${hop}`) + (extras.length ? ` (${extras.join(', ')})` : '');
}

function describeRoutingProcess(process: RoutingProcess, isTH: boolean): string {
  const details: string[] = [];
  let title: string;

  if (process.protocol === 'ospf') {
    title = `**OSPF ${process.processId}**${process.vrf ? ` (VRF ${process.vrf})` : ''}`;
    const networks = process.networks.map(n => code(`${formatAclAddress(n.address, n.wildcard)} area ${n.area}`));
    const interfaces = process.interfaces.map(i => code(`${i.name} area ${i.area}`));
    if (networks.length) details.push(`network ${listWithMore(networks, isTH)}`);
    if (interfaces.length) details.push(`${isTH ? 'อินเทอร์เฟซ' : 'interfaces'} ${listWithMore(interfaces, isTH)}`);
    if (process.defaultOriginate) details.push(isTH ? 'ประกาศ default route' : 'originates a default route');
  } else {
    title = `**BGP AS ${process.asNumber}**`;
    const neighbors = process.neighbors.map(n => {
      const info = [n.remoteAs && `AS ${n.remoteAs}`, n.description].filter(Boolean).join(', ');
      return code(n.address) + (info ? ` (${info})` : '');
    });
    const networks = process.networks.map(n => code(`${n.address}/${maskToPrefix(n.mask)}`));
    if (neighbors.length) details.push(`neighbor ${listWithMore(neighbors, isTH)}`);
    if (networks.length) details.push(`${isTH ? 'ประกาศ' : 'advertises'} ${listWithMore(networks, isTH)}`);
  }

  if (process.routerId) details.unshift(`router-id ${code(process.routerId)}`);
  if (process.redistribute.length) details.push(`redistribute ${process.redistribute.join(', ')}`);
  return `- ${title}${details.length ? `: ${details.join('; ')}` : ''}`;
}

function describeNatRule(rule: NatRule, isTH: boolean): string {
  const outsideSource = rule.direction === 'outside' ? ' (outside source)' : '';
  if (rule.type === 'dynamic') {
    const kind = rule.overload ? 'PAT' : 'Dynamic NAT';
    const target = rule.pool
      ? `pool ${code(rule.pool)}${rule.interface ? ` ${isTH ? 'บน' : 'on'} ${code(rule.interface)}` : ''}`
      : `${isTH ? 'IP ของ' : 'address of'} ${code(rule.interface ?? '?')}`;
    return `- **${kind}**${outsideSource}: ACL ${code(rule.acl)} → ${target}`;
  }
  const withPort = (host: string, port?: string) => (port ? `${host}:${port}` : host);
  const globalSide = withPort(rule.globalAddress ?? rule.interface ?? '?', rule.globalPort);
  const local = withPort(rule.localAddress, rule.localPort);
  return `- **Static NAT**${rule.protocol ? ` ${rule.protocol}` : ''}${outsideSource}: ${code(local)} ↔ ${code(globalSide)}`;
}

const withAclPort = (address: string, port?: string) => (port ? `${address} ${port}` : address);

/** Replaces the legacy summary's routing list and ACL count with structured Routing, NAT and ACL sections. */
export function describeFeatures(config: ExtractedNetworkConfig, isTH: boolean): string {
  const { staticRoutes, routingProcesses, nat, accessLists } = config;
  const sections: string[] = [];

  const routing: string[] = [];
  if (staticRoutes.length) {
    routing.push(`- **Static routes (${staticRoutes.length}):** ${listWithMore(staticRoutes.map(describeStaticRoute), isTH)}`);
  }
  routing.push(...routingProcesses.map(p => describeRoutingProcess(p, isTH)));
  if (!routingProcesses.length) {
    routing.push(`- *${isTH ? 'ไม่มี dynamic routing protocol (OSPF / BGP)' : 'No dynamic routing protocol (OSPF / BGP)'}*`);
  }
  sections.push(`#### 🧭 ${isTH ? 'การตั้งค่า Routing' : 'Routing'}\n\n${routing.join('\n')}`);

  if (nat.rules.length || nat.pools.length) {
    const lines: string[] = [];
    const roles = [
      nat.insideInterfaces.length && `**Inside:** ${nat.insideInterfaces.map(code).join(', ')}`,
      nat.outsideInterfaces.length && `**Outside:** ${nat.outsideInterfaces.map(code).join(', ')}`
    ].filter(Boolean);
    if (roles.length) lines.push(`- ${roles.join(' • ')}`);
    if (nat.pools.length) {
      lines.push(`- **Pools:** ${nat.pools.map(p => `${code(p.name)} ${p.startAddress} – ${p.endAddress}`).join(', ')}`);
    }
    lines.push(...nat.rules.map(r => describeNatRule(r, isTH)));
    sections.push(`#### 🔁 NAT\n\n${lines.join('\n')}`);
  }

  if (accessLists.length) {
    const rows = accessLists.flatMap(acl =>
      acl.rules.map(r =>
        [acl.name, acl.type, r.sequence ?? '-', r.action, r.protocol, withAclPort(r.source, r.sourcePort), withAclPort(r.destination, r.destinationPort)]
          .join(' | ')
      )
    );
    const hidden = rows.length - MAX_ACL_ROWS;
    const note = hidden > 0 ? `\n\n*${isTH ? `และอีก ${hidden} rule` : `…and ${hidden} more rules`}*` : '';
    const count = accessLists.length;
    const intro = isTH ? `พบ ${count} ACL` : `${count} ACL${count > 1 ? 's' : ''} configured.`;
    const table = rows.slice(0, MAX_ACL_ROWS).map(row => `| ${row} |`).join('\n');
    sections.push(`#### 🛡️ Access Control Lists (ACLs)

${intro}

| ACL | Type | Seq | Action | Protocol | Source | Destination |
|---|---|---|---|---|---|---|
${table}${note}`);
  }

  return sections.join('\n\n');
}

/** One-line routing / NAT / ACL overview for the default offline reply. */
export function featureOverview(config: ExtractedNetworkConfig, isTH: boolean): string {
  const processes = config.routingProcesses.map(p => (p.protocol === 'ospf' ? `OSPF ${p.processId}` : `BGP AS ${p.asNumber}`));
  const routing = processes.length ? processes.join(', ') : isTH ? 'ไม่มี OSPF / BGP' : 'no OSPF / BGP';
  const { staticRoutes, nat, accessLists } = config;
  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  return isTH
    ? `- **Routing / NAT / ACL:** ${routing} • Static route ${staticRoutes.length} • NAT rule ${nat.rules.length} • ACL ${accessLists.length}`
    : `- **Routing / NAT / ACL:** ${routing} • ${count(staticRoutes.length, 'static route')} • ${count(nat.rules.length, 'NAT rule')} • ${count(accessLists.length, 'ACL')}`;
}

const isPermitAll = (rule: AclRule) =>
  rule.action === 'permit' && rule.protocol === 'ip' && rule.source === 'any' && rule.destination === 'any';

/** Audit findings the offline engine can back with parsed evidence; the rest of its audit is generic guidance. */
export function auditFeatures(config: ExtractedNetworkConfig, isTH: boolean): string {
  const findings: string[] = [];

  for (const acl of config.accessLists) {
    for (const rule of acl.rules.filter(isPermitAll)) {
      const where = `ACL ${code(acl.name)}${rule.sequence !== undefined ? ` rule ${rule.sequence}` : ''}`;
      findings.push(
        isTH
          ? `**High** – ${where} อนุญาต IP ทั้งหมด (permit any any) ทำให้ rule ถัดไปไม่มีผล → ระบุ source / destination ให้แคบลง`
          : `**High** – ${where} permits all IP traffic (permit any any), so later rules never match → narrow the source / destination`
      );
    }
  }

  for (const rule of config.nat.rules) {
    if (rule.type !== 'static') continue;
    const host = code(rule.localPort ? `${rule.localAddress}:${rule.localPort}` : rule.localAddress);
    findings.push(
      isTH
        ? `**Medium** – Static NAT เปิด ${host} ให้เข้าถึงจากภายนอก → ใช้ inbound ACL บน outside interface จำกัดเฉพาะพอร์ตที่จำเป็น`
        : `**Medium** – Static NAT exposes ${host} to the outside → restrict it with an inbound ACL on the outside interface`
    );
  }

  if (config.routingProcesses.some(p => p.protocol === 'bgp' && p.neighbors.length)) {
    findings.push(
      isTH
        ? '**Low** – ตรวจสอบว่า BGP neighbor ทุกตัวเปิด authentication (`neighbor X password` / `peer X password cipher`) และมี prefix filter'
        : '**Low** – Verify every BGP neighbor uses authentication (`neighbor X password` / `peer X password cipher`) and prefix filtering'
    );
  }
  if (config.routingProcesses.some(p => p.protocol === 'ospf')) {
    findings.push(
      isTH
        ? '**Low** – ตรวจสอบว่า OSPF เปิด area / interface authentication เพื่อป้องกัน neighbor ปลอม'
        : '**Low** – Verify OSPF area / interface authentication is enabled to block rogue neighbours'
    );
  }
  if (!config.accessLists.length) {
    findings.push(
      isTH
        ? '**Low** – ไม่พบ ACL → ใช้ ACL จำกัดการเข้าถึง VTY / management และ traffic ขาเข้าจาก WAN'
        : '**Low** – No ACLs configured → use ACLs to restrict VTY / management access and inbound WAN traffic'
    );
  }

  const heading = isTH ? '#### 🔎 ผลตรวจ ACL / NAT / Routing จาก Config' : '#### 🔎 ACL / NAT / Routing Checks';
  const body = findings.length
    ? findings.map(f => `- ${f}`).join('\n')
    : `- ${isTH ? 'ไม่พบปัญหาจากการตรวจ ACL / NAT / Routing แบบ offline' : 'No issues found by the offline ACL / NAT / routing checks.'}`;
  return `${heading}\n\n${body}`;
}
