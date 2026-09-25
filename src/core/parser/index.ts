export { parseNetworkConfig, resolveVendor, extractSviGateways } from './cliParser';
export { parseCiscoIos, parseHuaweiVrp } from './vendorParsers';
export { expandVlanList, compressVlanList, prefixToMask, maskToPrefix, normalizeMask, splitSections } from './utils';
export { MOCK_RAW_CONFIGS, MOCK_PARSED_CONFIGS } from './mockData';
export type {
  ExtractedNetworkConfig,
  InterfaceEntry,
  InterfaceMode,
  ParseMeta,
  StaticRoute,
  SupportedVendor,
  SviGateway,
  VendorHint,
  VlanEntry
} from './types';
