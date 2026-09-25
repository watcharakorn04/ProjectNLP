import { ExtractedNetworkConfig, InterfaceEntry, StaticRoute } from './types';
import { isIPv4, isInSubnet, maskToPrefix, networkAddress } from './utils';

/**
 * Deterministic Mermaid topology built from `ExtractedNetworkConfig`, so the topology canvas works offline
 * without an LLM. It draws the device, its SVI / sub-interface gateways, routed IP interfaces, trunk links
 * and default routes. Labels come from the uploaded config, so every one is escaped before it reaches Mermaid.
 */

/** Nodes drawn per group (SVIs, IP interfaces, trunks) before the rest collapse into a "+N more" node. */
export const MAX_DIAGRAM_NODES_PER_GROUP = 8;

export type DeviceRole = 'Router' | 'L3 Switch' | 'Switch';

const ROLE_ICON: Record<DeviceRole, string> = { Router: '🌐', 'L3 Switch': '⚡', Switch: '🔲' };

const CLASS_DEFS = [
  'classDef mainDev fill:#0369a1,stroke:#38bdf8,stroke-width:2.5px,color:#ffffff;',
  'classDef vlanNode fill:#1e293b,stroke:#06b6d4,stroke-width:2px,color:#f8fafc;',
  'classDef ipNode fill:#172554,stroke:#60a5fa,stroke-width:2px,color:#eff6ff;',
  'classDef switchNode fill:#0f172a,stroke:#64748b,stroke-width:2px,color:#e2e8f0;',
  'classDef gwNode fill:#3b0764,stroke:#a855f7,stroke-width:2px,color:#f3e8ff;',
  'classDef wanNode fill:#4c1d95,stroke:#c084fc,stroke-width:2.5px,color:#faf5ff;',
  'classDef noteNode fill:#334155,stroke:#94a3b8,stroke-dasharray:4 3,color:#f1f5f9;'
];

/**
 * Escapes config text for a quoted Mermaid label. Quotes, angle brackets, `#`, `|` and backticks would
 * otherwise end the label, inject HTML or switch Mermaid into markdown-string mode.
 */
export function escapeMermaidLabel(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/#/g, '#35;')
    .replace(/&/g, '#38;')
    .replace(/"/g, '#quot;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/\|/g, '#124;')
    .replace(/`/g, '#96;');
}

/** Joins escaped label lines with Mermaid line breaks (valid with and without HTML labels). */
const label = (...lines: (string | undefined | false)[]) =>
  lines.filter((line): line is string => !!line).map(escapeMermaidLabel).join('<br/>');

/**
 * Switch ports or Vlan / Vlanif SVIs make it a switch, any L3 interface or routing makes it a router; both
 * make it an L3 switch. VLANs alone don't count when they come from router-on-a-stick sub-interfaces.
 */
export function inferDeviceRole(config: ExtractedNetworkConfig): DeviceRole {
  const subinterfaceOnly = config.sviGateways.length > 0 && config.sviGateways.every(gw => gw.kind === 'subinterface');
  const switching =
    config.interfaces.some(i => i.mode !== 'routed') ||
    config.sviGateways.some(gw => gw.kind === 'svi') ||
    (config.vlans.length > 0 && !subinterfaceOnly);
  const routing =
    config.sviGateways.length > 0 ||
    config.routingProcesses.length > 0 ||
    config.interfaces.some(i => i.mode === 'routed' && i.ipAddress);
  if (switching) return routing ? 'L3 Switch' : 'Switch';
  return 'Router';
}

const isDefaultRoute = (route: StaticRoute) => route.destination === '0.0.0.0' && maskToPrefix(route.mask) === 0;

/** A connected subnet the default route's next hop can be attached to. */
interface SubnetNode {
  id: string;
  interfaceName: string;
  network: string;
  mask: string;
}

/**
 * Builds a Mermaid `graph TD` for the topology canvas from parsed config alone. The output is always a
 * valid diagram: a config with nothing to draw yields the device plus a note node.
 */
export function generateTopologyMermaid(config: ExtractedNetworkConfig): string {
  const role = inferDeviceRole(config);
  const hostname = config.hostname || 'Device';
  const lines: string[] = ['graph TD', ...CLASS_DEFS.map(def => `    ${def}`), ''];
  const subnets: SubnetNode[] = [];
  const node = (id: string, shape: [string, string], text: string, cls: string) => {
    lines.push(`    ${id}${shape[0]}"${text}"${shape[1]}`, `    class ${id} ${cls};`);
  };
  const edge = (from: string, link: string, to: string, text?: string) => {
    lines.push(`    ${from} ${link}${text ? `|"${text}"|` : ''} ${to}`);
  };
  const addOverflow = (id: string, hidden: number, what: string) => {
    if (hidden <= 0) return;
    node(id, ['[', ']'], label(`… +${hidden} more ${what}`), 'noteNode');
    edge('DEV', '-.-', id);
  };
  const shutdownOf = new Map(config.interfaces.map(i => [i.name, i.shutdown]));
  const linkFor = (name: string, up: string) => (shutdownOf.get(name) ? '-.-' : up);
  const stateNote = (name: string) => shutdownOf.get(name) && '(shutdown)';

  node('DEV', ['{{', '}}'], label(`${ROLE_ICON[role]} ${hostname}`, `${config.vendor} • ${role}`), 'mainDev');

  // 1. SVI / sub-interface gateways: one subnet node per VLAN.
  const vlanNames = new Map(config.vlans.map(v => [v.vlanId, v.name]));
  const descriptions = new Map(config.interfaces.map(i => [i.name, i.description]));
  config.sviGateways.slice(0, MAX_DIAGRAM_NODES_PER_GROUP).forEach((gw, idx) => {
    const id = `SVI${idx}`;
    const name = vlanNames.get(gw.vlanId) ?? descriptions.get(gw.interfaceName);
    const network = `${networkAddress(gw.ipAddress, gw.subnetMask)}/${maskToPrefix(gw.subnetMask)}`;
    node(id, ['[', ']'], label(`📂 VLAN ${gw.vlanId}${name ? ` (${name})` : ''}`, network), 'vlanNode');
    const kind = gw.kind === 'svi' ? 'SVI' : 'dot1Q';
    edge('DEV', linkFor(gw.interfaceName, '---'), id, label(`${kind} ${gw.interfaceName}`, `GW ${gw.ipAddress}`, stateNote(gw.interfaceName)));
    subnets.push({ id, interfaceName: gw.interfaceName, network: gw.ipAddress, mask: gw.subnetMask });
  });
  addOverflow('SVIMore', config.sviGateways.length - MAX_DIAGRAM_NODES_PER_GROUP, 'VLAN gateways');

  // 2. Routed IP interfaces that are not already drawn as gateways.
  const gatewayNames = new Set(config.sviGateways.map(gw => gw.interfaceName));
  const routed = config.interfaces.filter(
    (i): i is InterfaceEntry & { ipAddress: string; subnetMask: string } =>
      !!i.ipAddress && !!i.subnetMask && !gatewayNames.has(i.name)
  );
  routed.slice(0, MAX_DIAGRAM_NODES_PER_GROUP).forEach((iface, idx) => {
    const id = `NET${idx}`;
    const network = `${networkAddress(iface.ipAddress, iface.subnetMask)}/${maskToPrefix(iface.subnetMask)}`;
    node(id, ['[', ']'], label(`🔗 ${iface.description ?? 'Subnet'}`, network), 'ipNode');
    edge('DEV', linkFor(iface.name, '---'), id, label(iface.name, iface.ipAddress, stateNote(iface.name)));
    subnets.push({ id, interfaceName: iface.name, network: iface.ipAddress, mask: iface.subnetMask });
  });
  addOverflow('NETMore', routed.length - MAX_DIAGRAM_NODES_PER_GROUP, 'IP interfaces');

  // 3. Trunk links to neighbouring switches.
  const trunks = config.interfaces.filter(i => i.mode === 'trunk');
  trunks.slice(0, MAX_DIAGRAM_NODES_PER_GROUP).forEach((trunk, idx) => {
    const id = `TRK${idx}`;
    node(
      id,
      ['[', ']'],
      label(
        `🔲 ${trunk.description ?? 'Neighbor switch'}`,
        `VLANs ${trunk.allowedVlans ?? 'all'}`,
        trunk.nativeVlan !== undefined && `native ${trunk.nativeVlan}`
      ),
      'switchNode'
    );
    edge('DEV', linkFor(trunk.name, '==='), id, label(`Trunk ${trunk.name}`, stateNote(trunk.name)));
  });
  addOverflow('TRKMore', trunks.length - MAX_DIAGRAM_NODES_PER_GROUP, 'trunks');

  // 4. Default routes: next hop (attached to its connected subnet when known) → WAN cloud.
  const defaults = config.staticRoutes.filter(isDefaultRoute);
  if (defaults.length) node('WAN', ['((', '))'], label('☁️ Internet / WAN'), 'wanNode');
  const gatewayIds = new Map<string, string>();
  defaults.forEach(route => {
    const subnet =
      subnets.find(s => isInSubnet(route.nextHop, s.network, s.mask)) ??
      subnets.find(s => s.interfaceName === (route.outInterface ?? route.nextHop));
    const from = subnet?.id ?? 'DEV';
    const extras = [route.distance !== undefined && `AD ${route.distance}`, route.vrf && `VRF ${route.vrf}`].filter(Boolean);
    const routeText = label(`0.0.0.0/0${extras.length ? ` (${extras.join(', ')})` : ''}`);

    if (!isIPv4(route.nextHop)) {
      // Interface-only route (e.g. `ip route 0.0.0.0 0.0.0.0 Dialer1`): no next-hop device to draw.
      edge(from, '-.->', 'WAN', label(`0.0.0.0/0 via ${route.nextHop}`));
      return;
    }
    let gwId = gatewayIds.get(route.nextHop);
    if (!gwId) {
      gwId = `GW${gatewayIds.size}`;
      gatewayIds.set(route.nextHop, gwId);
      node(gwId, ['[', ']'], label('🌐 Next hop', route.nextHop), 'gwNode');
      edge(from, '---', gwId, subnet ? undefined : label(route.outInterface ?? 'uplink'));
    }
    edge(gwId, '-.->', 'WAN', routeText);
  });

  if (!config.sviGateways.length && !routed.length && !trunks.length && !defaults.length) {
    node('EMPTY', ['[', ']'], label('No SVIs, IP interfaces, trunks or default routes found'), 'noteNode');
    edge('DEV', '-.-', 'EMPTY');
  }

  return lines.join('\n');
}
