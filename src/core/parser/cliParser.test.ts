/// <reference types="node" />
/**
 * Run with: npm run test:parser
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseNetworkConfig } from './cliParser';
import { MOCK_PARSED_CONFIGS, MOCK_RAW_CONFIGS, MockConfigKey } from './mockData';
import { compressVlanList, expandVlanList, normalizeMask, splitSections } from './utils';
import { SAMPLE_CONFIGS } from '../../utils/sampleConfigs';

const sample = (id: string) => {
  const found = SAMPLE_CONFIGS.find(s => s.id === id);
  if (!found) throw new Error(`Missing sample config: ${id}`);
  return found.rawContent;
};

describe('utils', () => {
  test('expands Cisco and Huawei VLAN range syntax', () => {
    assert.deepEqual(expandVlanList('10,20,30-32'), [10, 20, 30, 31, 32]);
    assert.deepEqual(expandVlanList('10 20 30 to 32'), [10, 20, 30, 31, 32]);
    assert.deepEqual(expandVlanList('0 4095 abc'), []);
  });

  test('compresses VLAN IDs into ranges', () => {
    assert.equal(compressVlanList([32, 10, 30, 31, 20, 10]), '10,20,30-32');
  });

  test('normalises dotted masks and prefix lengths', () => {
    assert.equal(normalizeMask('24'), '255.255.255.0');
    assert.equal(normalizeMask('/30'), '255.255.255.252');
    assert.equal(normalizeMask('0'), '0.0.0.0');
    assert.equal(normalizeMask('255.255.0.0'), '255.255.0.0');
    assert.equal(normalizeMask('33'), undefined);
  });

  test('splits sections even when indentation was lost', () => {
    const flat = 'hostname R1\n!\ninterface Gi0/1\nip address 10.0.0.1 255.255.255.0\nshutdown\nip route 0.0.0.0 0.0.0.0 10.0.0.2';
    const sections = splitSections(flat);
    assert.deepEqual(
      sections.map(s => [s.header, s.body]),
      [
        ['hostname R1', []],
        ['interface Gi0/1', ['ip address 10.0.0.1 255.255.255.0', 'shutdown']],
        ['ip route 0.0.0.0 0.0.0.0 10.0.0.2', []]
      ]
    );
  });
});

describe('parseNetworkConfig — golden mock fixtures', () => {
  for (const key of Object.keys(MOCK_RAW_CONFIGS) as MockConfigKey[]) {
    test(key, () => {
      assert.deepEqual(parseNetworkConfig(MOCK_RAW_CONFIGS[key]), MOCK_PARSED_CONFIGS[key]);
    });
  }
});

describe('parseNetworkConfig — bundled UI samples', () => {
  test('Huawei core switch', () => {
    const result = parseNetworkConfig(sample('huawei-core'));

    assert.equal(result.vendor, 'Huawei VRP');
    assert.equal(result.hostname, 'Core-Switch-01');
    assert.deepEqual(result.vlans.map(v => v.vlanId), [10, 20, 30, 99]);
    assert.deepEqual(
      result.sviGateways.map(g => [g.interfaceName, g.ipAddress, g.subnetMask, g.vlanId]),
      [
        ['Vlanif10', '192.168.10.1', '255.255.255.0', 10],
        ['Vlanif20', '192.168.20.1', '255.255.255.0', 20],
        ['Vlanif30', '192.168.30.1', '255.255.255.0', 30],
        ['Vlanif99', '10.0.99.1', '255.255.255.252', 99]
      ]
    );
    const uplink = result.interfaces.find(i => i.name === 'GigabitEthernet0/0/1');
    assert.equal(uplink?.mode, 'trunk');
    assert.equal(uplink?.allowedVlans, '10,20,30');
    const fwLink = result.interfaces.find(i => i.name === 'GigabitEthernet0/0/24');
    assert.equal(fwLink?.mode, 'access');
    assert.equal(fwLink?.vlan, 99);
    assert.deepEqual(result.staticRoutes, [{ destination: '0.0.0.0', mask: '0.0.0.0', nextHop: '10.0.99.2' }]);
  });

  test('Cisco campus distribution switch', () => {
    const result = parseNetworkConfig(sample('cisco-campus'));

    assert.equal(result.vendor, 'Cisco IOS');
    assert.equal(result.hostname, 'Campus-Dist-SW01');
    assert.deepEqual(result.vlans, [
      { vlanId: 10, name: 'Corporate_Data' },
      { vlanId: 20, name: 'VoIP_Phones' },
      { vlanId: 100, name: 'Server_Farm' }
    ]);
    assert.deepEqual(
      result.interfaces.map(i => [i.name, i.mode]),
      [
        ['GigabitEthernet1/0/1', 'trunk'],
        ['GigabitEthernet1/0/2', 'trunk'],
        ['GigabitEthernet1/0/24', 'access'],
        ['Vlan10', 'routed'],
        ['Vlan20', 'routed'],
        ['Vlan100', 'routed']
      ]
    );
    assert.equal(result.sviGateways.length, 3);
    assert.deepEqual(result.staticRoutes, [{ destination: '0.0.0.0', mask: '0.0.0.0', nextHop: '10.10.100.254' }]);
  });

  test('Cisco branch router (router-on-a-stick)', () => {
    const result = parseNetworkConfig(sample('cisco-router'));

    assert.equal(result.hostname, 'Branch-RTR-01');
    // No switchport config → physical ports are routed, not access.
    assert.ok(result.interfaces.every(i => i.mode === 'routed'));
    assert.deepEqual(
      result.sviGateways.map(g => [g.interfaceName, g.vlanId, g.kind]),
      [
        ['GigabitEthernet0/0.10', 10, 'subinterface'],
        ['GigabitEthernet0/0.20', 20, 'subinterface']
      ]
    );
    assert.equal(result.interfaces.find(i => i.name === 'GigabitEthernet0/1')?.ipAddress, '203.0.113.14');
  });
});

describe('parseNetworkConfig — vendor resolution & edge cases', () => {
  test('vendorHint forces the parser and warns on strong disagreement', () => {
    const result = parseNetworkConfig(sample('huawei-core'), 'Cisco');
    assert.equal(result.vendor, 'Cisco IOS');
    assert.equal(result.meta.detectedBy, 'hint');
    assert.match(result.meta.warnings[0], /overrides auto-detection/);
  });

  test('unknown vendor defaults to Cisco IOS with a warning', () => {
    const result = parseNetworkConfig('interface Gi0/1\n ip address 10.0.0.1 255.255.255.0');
    assert.equal(result.vendor, 'Cisco IOS');
    assert.equal(result.meta.confidence, 0);
    assert.ok(result.meta.warnings.some(w => w.includes('Could not detect vendor')));
    assert.equal(result.hostname, 'Unknown-Device');
  });

  test('empty input returns an empty structure instead of throwing', () => {
    const result = parseNetworkConfig('   ');
    assert.deepEqual(result.interfaces, []);
    assert.ok(result.meta.warnings.includes('Configuration is empty.'));
  });

  test('handles CRLF line endings, secondary IPs and VRF routes', () => {
    const cfg = [
      'hostname EDGE',
      'interface GigabitEthernet0/0',
      ' ip address 10.1.1.1 255.255.255.0',
      ' ip address 10.2.2.1 255.255.255.0 secondary',
      'ip route vrf CUST 192.168.0.0 255.255.0.0 10.1.1.254 name CUST_NET'
    ].join('\r\n');
    const result = parseNetworkConfig(cfg, 'Cisco');
    assert.equal(result.interfaces[0].ipAddress, '10.1.1.1');
    assert.deepEqual(result.staticRoutes, [
      { destination: '192.168.0.0', mask: '255.255.0.0', nextHop: '10.1.1.254', vrf: 'CUST' }
    ]);
  });
});
