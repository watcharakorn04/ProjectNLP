export { parseNetworkConfig, resolveVendor, extractSviGateways } from './cliParser';
export { parseCiscoIos, parseHuaweiVrp } from './vendorParsers';
export {
  expandVlanList,
  compressVlanList,
  formatAclAddress,
  prefixToMask,
  maskToPrefix,
  networkAddress,
  isInSubnet,
  normalizeMask,
  splitSections
} from './utils';
export { MOCK_RAW_CONFIGS, MOCK_PARSED_CONFIGS } from './mockData';
export { parseCiscoAcls, parseHuaweiAcls } from './aclParser';
export { parseCiscoNat, parseHuaweiNat } from './natParser';
export { parseCiscoRouting, parseHuaweiRouting } from './routingParser';
export { generateTopologyMermaid, inferDeviceRole, escapeMermaidLabel, MAX_DIAGRAM_NODES_PER_GROUP } from './diagramGenerator';
export type { DeviceRole } from './diagramGenerator';
export { detectFeatureTopics, describeFeatureTopics, FEATURE_TOPICS, MAX_TABLE_ROWS } from './smartRuleEngine';
export type { FeatureTopic } from './smartRuleEngine';
export type {
  AccessList,
  AclRule,
  AclType,
  BgpNeighbor,
  BgpProcess,
  DynamicNatRule,
  ExtractedNetworkConfig,
  InterfaceEntry,
  InterfaceMode,
  NatConfig,
  NatPool,
  NatRule,
  OspfNetwork,
  OspfProcess,
  ParseMeta,
  RoutingProcess,
  StaticNatRule,
  StaticRoute,
  SupportedVendor,
  SviGateway,
  VendorHint,
  VlanEntry
} from './types';
