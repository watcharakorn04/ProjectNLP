import { BgpNeighbor, BgpProcess, ConfigSection, OspfProcess, RoutingProcess } from './types';
import {
  classfulMask,
  interfaceNameFromHeader,
  isIPv4,
  normalizeMask,
  parseAreaId,
  pushUnique,
  stripUndefined
} from './utils';

/**
 * Collects processes in config order. OSPF can be enabled from interface sections before its
 * `router ospf` / `ospf` block appears, so processes are created on first reference.
 */
class RoutingCollector {
  private readonly processes = new Map<string, RoutingProcess>();
  /** Per BGP process: peer-group / group name -> AS, and member -> group, resolved in `result()`. */
  private readonly groupAs = new Map<string, Map<string, string>>();
  private readonly memberGroup = new Map<string, Map<string, string>>();

  ospf(processId: number): OspfProcess {
    const key = `ospf:${processId}`;
    let process = this.processes.get(key) as OspfProcess | undefined;
    if (!process) {
      process = { protocol: 'ospf', processId, networks: [], interfaces: [], redistribute: [], defaultOriginate: false };
      this.processes.set(key, process);
    }
    return process;
  }

  bgp(asNumber: string): BgpProcess {
    const key = `bgp:${asNumber}`;
    let process = this.processes.get(key) as BgpProcess | undefined;
    if (!process) {
      process = { protocol: 'bgp', asNumber, neighbors: [], networks: [], redistribute: [] };
      this.processes.set(key, process);
      this.groupAs.set(asNumber, new Map());
      this.memberGroup.set(asNumber, new Map());
    }
    return process;
  }

  neighbor(bgp: BgpProcess, address: string): BgpNeighbor {
    let neighbor = bgp.neighbors.find(n => n.address === address);
    if (!neighbor) {
      neighbor = { address };
      bgp.neighbors.push(neighbor);
    }
    return neighbor;
  }

  /** `remote-as` / `as-number` on either a neighbor address or a group name. */
  remoteAs(bgp: BgpProcess, peer: string, remoteAs: string): void {
    if (isIPv4(peer)) this.neighbor(bgp, peer).remoteAs = remoteAs;
    else this.groupAs.get(bgp.asNumber)!.set(peer, remoteAs);
  }

  joinGroup(bgp: BgpProcess, address: string, group: string): void {
    this.neighbor(bgp, address);
    this.memberGroup.get(bgp.asNumber)!.set(address, group);
  }

  result(): RoutingProcess[] {
    for (const process of this.processes.values()) {
      if (process.protocol !== 'bgp') continue;
      const groups = this.groupAs.get(process.asNumber)!;
      const members = this.memberGroup.get(process.asNumber)!;
      process.neighbors = process.neighbors.map(n => {
        const group = members.get(n.address);
        return stripUndefined<BgpNeighbor>({ ...n, remoteAs: n.remoteAs ?? (group ? groups.get(group) : undefined) });
      });
    }
    return [...this.processes.values()];
  }
}

/** Normalises a redistributed source across vendors: Huawei `direct` is Cisco `connected`; keeps a process ID / AS. */
function redistributedSource(tokens: string[]): string | undefined {
  const protocol = tokens[0]?.toLowerCase();
  if (!protocol) return undefined;
  const name = protocol === 'direct' ? 'connected' : protocol;
  return /^\d+(\.\d+)?$/.test(tokens[1] ?? '') ? `${name} ${tokens[1]}` : name;
}

function bgpNetwork(address: string, rawMask: string | undefined): { address: string; mask: string } | undefined {
  if (!isIPv4(address)) return undefined;
  const mask = rawMask === undefined ? classfulMask(address) : normalizeMask(rawMask);
  return mask ? { address, mask } : undefined;
}

function addInterfaceArea(process: OspfProcess, name: string, rawArea: string): void {
  const area = parseAreaId(rawArea);
  if (area !== undefined && !process.interfaces.some(i => i.name === name)) process.interfaces.push({ name, area });
}

// ---------------------------------------------------------------------------
// Cisco IOS
// ---------------------------------------------------------------------------

function parseCiscoOspf(process: OspfProcess, body: string[]): void {
  for (const cmd of body) {
    let m: RegExpMatchArray | null;
    if ((m = cmd.match(/^router-id\s+(\S+)/i)) && isIPv4(m[1])) process.routerId = m[1];
    else if ((m = cmd.match(/^network\s+(\S+)\s+(\S+)\s+area\s+(\S+)/i))) {
      const area = parseAreaId(m[3]);
      if (isIPv4(m[1]) && isIPv4(m[2]) && area !== undefined) {
        process.networks.push({ address: m[1], wildcard: m[2], area });
      }
    } else if ((m = cmd.match(/^redistribute\s+(.+)$/i))) {
      const source = redistributedSource(m[1].split(/\s+/));
      if (source) pushUnique(process.redistribute, source);
    } else if (/^default-information originate\b/i.test(cmd)) process.defaultOriginate = true;
  }
}

function parseCiscoBgp(collector: RoutingCollector, bgp: BgpProcess, body: string[]): void {
  // Networks and redistribution are only collected for global IPv4 unicast, not VRF / IPv6 / VPN families.
  let ipv4Unicast = true;

  for (const cmd of body) {
    let m: RegExpMatchArray | null;
    if ((m = cmd.match(/^address-family\s+(.+)$/i))) {
      ipv4Unicast = /^ipv4(\s+unicast)?$/i.test(m[1].trim());
    } else if (/^exit-address-family$/i.test(cmd)) {
      ipv4Unicast = true;
    } else if ((m = cmd.match(/^bgp router-id\s+(\S+)/i)) && isIPv4(m[1])) {
      bgp.routerId = m[1];
    } else if ((m = cmd.match(/^neighbor\s+(\S+)\s+remote-as\s+(\S+)/i))) {
      collector.remoteAs(bgp, m[1], m[2]);
    } else if ((m = cmd.match(/^neighbor\s+(\S+)\s+description\s+(.+)$/i)) && isIPv4(m[1])) {
      collector.neighbor(bgp, m[1]).description = m[2];
    } else if ((m = cmd.match(/^neighbor\s+(\S+)\s+peer-group\s+(\S+)/i)) && isIPv4(m[1])) {
      collector.joinGroup(bgp, m[1], m[2]);
    } else if (ipv4Unicast && (m = cmd.match(/^network\s+(\S+)(?:\s+mask\s+(\S+))?/i))) {
      const network = bgpNetwork(m[1], m[2]);
      if (network) bgp.networks.push(network);
    } else if (ipv4Unicast && (m = cmd.match(/^redistribute\s+(.+)$/i))) {
      const source = redistributedSource(m[1].split(/\s+/));
      if (source) pushUnique(bgp.redistribute, source);
    }
  }
}

/** `router ospf` / `router bgp` blocks and interface-level `ip ospf <pid> area <a>`. */
export function parseCiscoRouting(sections: ConfigSection[]): RoutingProcess[] {
  const collector = new RoutingCollector();

  for (const { header, body } of sections) {
    const ifaceName = interfaceNameFromHeader(header);
    let m: RegExpMatchArray | null;
    if (ifaceName) {
      for (const cmd of body) {
        if ((m = cmd.match(/^ip ospf\s+(\d+)\s+area\s+(\S+)/i))) {
          addInterfaceArea(collector.ospf(Number(m[1])), ifaceName, m[2]);
        }
      }
    } else if ((m = header.match(/^router ospf\s+(\d+)(?:\s+vrf\s+(\S+))?/i))) {
      const process = collector.ospf(Number(m[1]));
      if (m[2]) process.vrf = m[2];
      parseCiscoOspf(process, body);
    } else if ((m = header.match(/^router bgp\s+(\S+)/i))) {
      parseCiscoBgp(collector, collector.bgp(m[1]), body);
    }
  }

  return collector.result();
}

// ---------------------------------------------------------------------------
// Huawei VRP
// ---------------------------------------------------------------------------

/** Body of `ospf [pid] [router-id X] [vpn-instance V]`: `network` lines belong to the preceding `area` line. */
function parseHuaweiOspf(process: OspfProcess, body: string[]): void {
  let area: number | undefined;

  for (const cmd of body) {
    let m: RegExpMatchArray | null;
    if ((m = cmd.match(/^area\s+(\S+)/i))) area = parseAreaId(m[1]);
    else if ((m = cmd.match(/^network\s+(\S+)\s+(\S+)/i))) {
      if (area !== undefined && isIPv4(m[1]) && isIPv4(m[2])) {
        process.networks.push({ address: m[1], wildcard: m[2], area });
      }
    } else if ((m = cmd.match(/^import-route\s+(.+)$/i))) {
      const source = redistributedSource(m[1].split(/\s+/));
      if (source) pushUnique(process.redistribute, source);
    } else if (/^default-route-advertise\b/i.test(cmd)) process.defaultOriginate = true;
  }
}

function parseHuaweiBgp(collector: RoutingCollector, bgp: BgpProcess, body: string[]): void {
  // Commands before the first *-family line belong to the BGP view; IPv4 unicast is the default family.
  let ipv4Unicast = true;

  for (const cmd of body) {
    let m: RegExpMatchArray | null;
    if (/^(ipv4-family|ipv6-family|l2vpn-family|evpn|vpnv4|vpn-instance)\b/i.test(cmd)) {
      ipv4Unicast = /^ipv4-family(\s+unicast)?$/i.test(cmd);
    } else if ((m = cmd.match(/^router-id\s+(\S+)/i)) && isIPv4(m[1])) {
      bgp.routerId = m[1];
    } else if ((m = cmd.match(/^peer\s+(\S+)\s+as-number\s+(\S+)/i))) {
      collector.remoteAs(bgp, m[1], m[2]);
    } else if ((m = cmd.match(/^peer\s+(\S+)\s+description\s+(.+)$/i)) && isIPv4(m[1])) {
      collector.neighbor(bgp, m[1]).description = m[2];
    } else if ((m = cmd.match(/^peer\s+(\S+)\s+group\s+(\S+)/i)) && isIPv4(m[1])) {
      collector.joinGroup(bgp, m[1], m[2]);
    } else if (ipv4Unicast && (m = cmd.match(/^network\s+(\S+)(?:\s+(\S+))?/i))) {
      const network = bgpNetwork(m[1], m[2]);
      if (network) bgp.networks.push(network);
    } else if (ipv4Unicast && (m = cmd.match(/^import-route\s+(.+)$/i))) {
      const source = redistributedSource(m[1].split(/\s+/));
      if (source) pushUnique(bgp.redistribute, source);
    }
  }
}

/** `ospf` / `bgp` blocks and interface-level `ospf enable <pid> area <a>`. */
export function parseHuaweiRouting(sections: ConfigSection[]): RoutingProcess[] {
  const collector = new RoutingCollector();

  for (const { header, body } of sections) {
    const ifaceName = interfaceNameFromHeader(header);
    let m: RegExpMatchArray | null;
    if (ifaceName) {
      for (const cmd of body) {
        if ((m = cmd.match(/^ospf enable\s+(\d+)\s+area\s+(\S+)/i))) {
          addInterfaceArea(collector.ospf(Number(m[1])), ifaceName, m[2]);
        }
      }
    } else if ((m = header.match(/^ospf(?:\s+(\d+))?(?:\s+(.*))?$/i))) {
      // `ospf` without an ID is process 1.
      const process = collector.ospf(m[1] ? Number(m[1]) : 1);
      const options = m[2] ?? '';
      const routerId = options.match(/\brouter-id\s+(\S+)/i)?.[1];
      const vrf = options.match(/\bvpn-instance\s+(\S+)/i)?.[1];
      if (isIPv4(routerId)) process.routerId = routerId;
      if (vrf) process.vrf = vrf;
      parseHuaweiOspf(process, body);
    } else if ((m = header.match(/^bgp\s+(\S+)/i))) {
      parseHuaweiBgp(collector, collector.bgp(m[1]), body);
    }
  }

  return collector.result();
}
