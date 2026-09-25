import { UploadedConfigFile, VendorType } from '../types/network';
import { parseNetworkConfig as parseLegacyConfig } from '../utils/networkParser';
import type { SampleConfig } from '../utils/sampleConfigs';
import { parseNetworkConfig } from './parser';
import type { ExtractedNetworkConfig, SupportedVendor, VendorHint } from './parser';

/**
 * Turns raw config text (an uploaded file or a bundled sample) into the
 * `UploadedConfigFile` held in app state. Pure: no React, no DOM.
 */

export const ACCEPTED_CONFIG_EXTENSIONS = ['.txt', '.cfg', '.conf', '.log'];
export const MAX_CONFIG_BYTES = 2 * 1024 * 1024;

export interface ConfigSource {
  fileName: string;
  rawContent: string;
  sizeBytes: number;
  vendorHint?: VendorHint;
}

export type ConfigLoadError = 'empty' | 'unparseable' | 'unsupported-type' | 'too-large' | 'read-failed';

export type ConfigLoadResult =
  | { ok: true; file: UploadedConfigFile; warnings: string[] }
  | { ok: false; fileName: string; error: ConfigLoadError };

const VENDOR_TO_HINT: Record<SupportedVendor, VendorHint> = {
  'Cisco IOS': 'Cisco',
  'Huawei VRP': 'Huawei'
};

export function formatFileSize(bytes: number): string {
  return bytes > 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

export function configLoadFailure(fileName: string, error: ConfigLoadError): ConfigLoadResult {
  return { ok: false, fileName, error };
}

/** Pre-read checks on a picked / dropped file. Files without an extension (e.g. `running-config`) are allowed. */
export function validateConfigFile(file: { name: string; size: number }): ConfigLoadError | null {
  const dot = file.name.lastIndexOf('.');
  const extension = dot > 0 ? file.name.slice(dot).toLowerCase() : '';
  if (extension && !ACCEPTED_CONFIG_EXTENSIONS.includes(extension)) return 'unsupported-type';
  if (file.size > MAX_CONFIG_BYTES) return 'too-large';
  return null;
}

/** True when the parser found something worth analysing, not just a hostname line or free text. */
export function hasExtractedContent(config: ExtractedNetworkConfig): boolean {
  return config.interfaces.length > 0 || config.vlans.length > 0 || config.staticRoutes.length > 0;
}

export function configSourceFromSample(sample: SampleConfig): ConfigSource {
  return {
    fileName: sample.fileName,
    rawContent: sample.rawContent,
    sizeBytes: new Blob([sample.rawContent]).size,
    vendorHint: VENDOR_TO_HINT[sample.vendor]
  };
}

export function loadConfigSource(
  source: ConfigSource,
  uploadedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
): ConfigLoadResult {
  const { fileName, rawContent, sizeBytes, vendorHint } = source;
  if (!rawContent.trim()) return configLoadFailure(fileName, 'empty');

  const extractedConfig = parseNetworkConfig(rawContent, vendorHint);
  if (!hasExtractedContent(extractedConfig)) return configLoadFailure(fileName, 'unparseable');

  // Confidence 0 means the core parser fell back to Cisco IOS without any vendor evidence.
  const detectedVendor: VendorType = extractedConfig.meta.confidence > 0 ? extractedConfig.vendor : 'Unknown';

  return {
    ok: true,
    warnings: extractedConfig.meta.warnings,
    file: {
      fileName,
      fileSize: formatFileSize(sizeBytes),
      rawContent,
      detectedVendor,
      // Legacy shape, still consumed by the Gemini client and diagram generator.
      parsedData: parseLegacyConfig(rawContent),
      extractedConfig,
      uploadedAt
    }
  };
}
