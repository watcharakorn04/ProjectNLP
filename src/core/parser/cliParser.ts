import { detectVendor } from '../../utils/vendorDetector';
import {
  ExtractedNetworkConfig,
  InterfaceEntry,
  ParseMeta,
  SupportedVendor,
  SviGateway,
  VendorHint,
  VendorParseResult,
  VlanEntry
} from './types';
import { parseCiscoIos, parseHuaweiVrp } from './vendorParsers';
import { countLines } from './utils';

const HINT_TO_VENDOR: Record<VendorHint, SupportedVendor> = {
  Cisco: 'Cisco IOS',
  Huawei: 'Huawei VRP'
};

const VENDOR_PARSERS: Record<SupportedVendor, (rawConfig: string) => VendorParseResult> = {
  'Cisco IOS': parseCiscoIos,
  'Huawei VRP': parseHuaweiVrp
};

interface VendorResolution {
  vendor: SupportedVendor;
  detectedBy: ParseMeta['detectedBy'];
  confidence: number;
  warnings: string[];
}

export function resolveVendor(rawConfig: string, vendorHint?: VendorHint): VendorResolution {
  const detection = detectVendor(rawConfig);

  if (vendorHint) {
    const vendor = HINT_TO_VENDOR[vendorHint];
    const warnings =
      detection.vendor !== 'Unknown' && detection.vendor !== vendor && detection.confidence >= 80
        ? [`Vendor hint "${vendorHint}" overrides auto-detection, which found ${detection.vendor} (${detection.confidence}% confidence).`]
        : [];
    return { vendor, detectedBy: 'hint', confidence: 100, warnings };
  }

  if (detection.vendor !== 'Unknown') {
    return { vendor: detection.vendor, detectedBy: 'auto', confidence: detection.confidence, warnings: [] };
  }

  return {
    vendor: 'Cisco IOS',
    detectedBy: 'auto',
    confidence: 0,
    warnings: ['Could not detect vendor from syntax; defaulted to Cisco IOS. Pass a vendorHint to override.']
  };
}

const SVI_NAME_RE = /^vlan(?:if)?(\d+)$/i;

/** Derives L3 VLAN gateways from Vlan/Vlanif SVIs and 802.1Q router sub-interfaces. */
export function extractSviGateways(interfaces: InterfaceEntry[]): SviGateway[] {
  const gateways: SviGateway[] = [];
  for (const iface of interfaces) {
    if (!iface.ipAddress || !iface.subnetMask) continue;

    const sviMatch = iface.name.match(SVI_NAME_RE);
    if (sviMatch) {
      gateways.push({
        interfaceName: iface.name,
        ipAddress: iface.ipAddress,
        subnetMask: iface.subnetMask,
        vlanId: Number(sviMatch[1]),
        kind: 'svi'
      });
    } else if (iface.name.includes('.') && iface.vlan !== undefined) {
      gateways.push({
        interfaceName: iface.name,
        ipAddress: iface.ipAddress,
        subnetMask: iface.subnetMask,
        vlanId: iface.vlan,
        kind: 'subinterface'
      });
    }
  }
  return gateways;
}

function mergeGatewayVlans(vlans: VlanEntry[], gateways: SviGateway[]): VlanEntry[] {
  const byId = new Map(vlans.map(v => [v.vlanId, v]));
  for (const gw of gateways) {
    if (!byId.has(gw.vlanId)) byId.set(gw.vlanId, { vlanId: gw.vlanId });
  }
  return [...byId.values()].sort((a, b) => a.vlanId - b.vlanId);
}

/**
 * Parses a Cisco IOS or Huawei VRP running configuration into structured JSON.
 *
 * @param rawConfig  Raw CLI text (`show running-config` / `display current-configuration`).
 * @param vendorHint Skip auto-detection and force a vendor parser.
 */
export function parseNetworkConfig(rawConfig: string, vendorHint?: VendorHint): ExtractedNetworkConfig {
  const resolution = resolveVendor(rawConfig, vendorHint);
  const warnings = [...resolution.warnings];

  if (!rawConfig.trim()) warnings.push('Configuration is empty.');

  const parsed = VENDOR_PARSERS[resolution.vendor](rawConfig);
  const sviGateways = extractSviGateways(parsed.interfaces);

  if (!parsed.hostname) {
    warnings.push(`No ${resolution.vendor === 'Huawei VRP' ? 'sysname' : 'hostname'} command found.`);
  }
  if (rawConfig.trim() && parsed.interfaces.length === 0) {
    warnings.push('No interface blocks found.');
  }

  return {
    hostname: parsed.hostname || 'Unknown-Device',
    vendor: resolution.vendor,
    vlans: mergeGatewayVlans(parsed.vlans, sviGateways),
    interfaces: parsed.interfaces,
    sviGateways,
    staticRoutes: parsed.staticRoutes,
    meta: {
      detectedBy: resolution.detectedBy,
      confidence: resolution.confidence,
      lineCount: countLines(rawConfig),
      warnings
    }
  };
}
