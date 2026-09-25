export { parseNetworkConfig, resolveVendor, extractSviGateways } from './cliParser';
export { parseCiscoIos, parseHuaweiVrp } from './vendorParsers';
export {
  expandVlanList,
  compressVlanList,
  formatAclAddress,
  prefixToMask,
  maskToPrefix,
  normalizeMask,
  splitSections
} from './utils';
export { MOCK_RAW_CONFIGS, MOCK_PARSED_CONFIGS } from './mockData';
export { parseCiscoAcls, parseHuaweiAcls } from './aclParser';
export { parseCiscoNat, parseHuaweiNat } from './natParser';
export { parseCiscoRouting, parseHuaweiRouting } from './routingParser';
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
