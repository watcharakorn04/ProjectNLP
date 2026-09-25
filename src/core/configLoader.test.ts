/// <reference types="node" />
/**
 * Run with: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { configSourceFromSample, loadConfigSource, MAX_CONFIG_BYTES, validateConfigFile } from './configLoader';
import { maskToPrefix } from './parser';
import { SAMPLE_CONFIGS } from '../utils/sampleConfigs';

const source = (rawContent: string, fileName = 'test.txt') => ({ fileName, rawContent, sizeBytes: rawContent.length });

describe('validateConfigFile', () => {
  test('accepts config extensions and extensionless files', () => {
    for (const name of ['a.txt', 'b.CFG', 'c.conf', 'd.log', 'running-config', '.hidden']) {
      assert.equal(validateConfigFile({ name, size: 100 }), null, name);
    }
  });

  test('rejects other extensions and oversized files', () => {
    assert.equal(validateConfigFile({ name: 'diagram.png', size: 100 }), 'unsupported-type');
    assert.equal(validateConfigFile({ name: 'huge.txt', size: MAX_CONFIG_BYTES + 1 }), 'too-large');
  });
});

describe('loadConfigSource', () => {
  test('rejects empty and whitespace-only content', () => {
    assert.deepEqual(loadConfigSource(source('')), { ok: false, fileName: 'test.txt', error: 'empty' });
    assert.deepEqual(loadConfigSource(source('  \n\t\n')), { ok: false, fileName: 'test.txt', error: 'empty' });
  });

  test('rejects text with no interfaces, VLANs or routes', () => {
    for (const raw of ['hello world\nthis is a grocery list', 'hostname R1', '\x00\x01PNG garbage']) {
      const result = loadConfigSource(source(raw));
      assert.equal(result.ok, false, raw);
      assert.equal(!result.ok && result.error, 'unparseable');
    }
  });

  test('marks vendor Unknown when the parser had to fall back', () => {
    const result = loadConfigSource(source('interface Gi0/1\n ip address 10.0.0.1 255.255.255.0'));
    assert.ok(result.ok);
    assert.equal(result.file.detectedVendor, 'Unknown');
    assert.ok(result.warnings.some(w => w.includes('Could not detect vendor')));
  });

  for (const sample of SAMPLE_CONFIGS) {
    test(`loads sample "${sample.id}" with both parser outputs populated`, () => {
      const result = loadConfigSource(configSourceFromSample(sample), '10:30 AM');
      assert.ok(result.ok);
      const { file } = result;
      assert.equal(file.fileName, sample.fileName);
      assert.equal(file.detectedVendor, sample.vendor);
      assert.equal(file.uploadedAt, '10:30 AM');
      assert.equal(file.extractedConfig?.meta.detectedBy, 'hint');
      assert.ok((file.extractedConfig?.interfaces.length ?? 0) > 0);
      assert.ok(file.parsedData, 'legacy parsedData is still produced for downstream consumers');
      assert.deepEqual(result.warnings, []);
    });
  }
});

test('maskToPrefix', () => {
  assert.equal(maskToPrefix('255.255.255.0'), 24);
  assert.equal(maskToPrefix('255.255.255.252'), 30);
  assert.equal(maskToPrefix('0.0.0.0'), 0);
  assert.equal(maskToPrefix('255.255.255.255'), 32);
});
