/// <reference types="node" />
/**
 * ACL, NAT and OSPF/BGP extraction. Full end-to-end shapes live in the golden fixtures (`mockData.ts`);
 * these cover the edge cases. Run with: npm run test:parser
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseNetworkConfig } from './cliParser';
import { parseCiscoAcls, parseHuaweiAcls } from './aclParser';
import { parseCiscoNat, parseHuaweiNat } from './natParser';
import { parseCiscoRouting, parseHuaweiRouting } from './routingParser';
import { classfulMask, formatAclAddress, parseAreaId, splitSections, wildcardToPrefix } from './utils';
import { SAMPLE_CONFIGS } from '../../utils/sampleConfigs';

const sections = (lines: string[]) => splitSections(lines.join('\n'));

describe('feature utils', () => {
  test('converts contiguous wildcards to prefixes and rejects the rest', () => {
    assert.equal(wildcardToPrefix('0.0.0.0'), 32);
    assert.equal(wildcardToPrefix('0.0.0.255'), 24);
    assert.equal(wildcardToPrefix('255.255.255.255'), 0);
    assert.equal(wildcardToPrefix('0.0.255.0'), undefined);
  });

  test('formats ACL addresses, including the Huawei "0" host wildcard', () => {
    assert.equal(formatAclAddress('10.0.0.5'), '10.0.0.5/32');
    assert.equal(formatAclAddress('10.0.0.5', '0'), '10.0.0.5/32');
    assert.equal(formatAclAddress('10.0.0.0', '0.0.255.255'), '10.0.0.0/16');
    assert.equal(formatAclAddress('10.0.0.0', '0.255.0.255'), '10.0.0.0 0.255.0.255');
  });

  test('parses OSPF areas in both notations and derives classful masks', () => {
    assert.equal(parseAreaId('0'), 0);
    assert.equal(parseAreaId('0.0.0.0'), 0);
    assert.equal(parseAreaId('0.0.1.0'), 256);
    assert.equal(parseAreaId('x'), undefined);
    assert.equal(classfulMask('10.0.0.0'), '255.0.0.0');
    assert.equal(classfulMask('172.16.0.0'), '255.255.0.0');
    assert.equal(classfulMask('192.168.1.0'), '255.255.255.0');
  });

  test('indented delimiters inside a block do not close it; top-level ones still do', () => {
    const result = sections(['bgp 100', ' peer 1.1.1.1 as-number 200', ' #', ' ipv4-family unicast', '  network 10.0.0.0 8', '#', 'sysname X']);
    assert.deepEqual(
      result.map(s => [s.header, s.body]),
      [
        ['bgp 100', ['peer 1.1.1.1 as-number 200', 'ipv4-family unicast', 'network 10.0.0.0 8']],
        ['sysname X', []]
      ]
    );
  });
});

describe('ACLs', () => {
  test('Cisco: merges numbered lines, skips remarks and unsupported numbers', () => {
    const acls = parseCiscoAcls(
      sections([
        'access-list 10 remark users',
        'access-list 10 permit host 10.0.0.1',
        'access-list 10 permit 10.0.0.2',
        'access-list 200 permit 0x0800 0x0000',
        'ip access-list standard 10',
        ' 30 deny any log'
      ])
    );
    assert.deepEqual(acls, [
      {
        name: '10',
        type: 'standard',
        rules: [
          { action: 'permit', protocol: 'ip', source: '10.0.0.1/32', destination: 'any' },
          { action: 'permit', protocol: 'ip', source: '10.0.0.2/32', destination: 'any' },
          { sequence: 30, action: 'deny', protocol: 'ip', source: 'any', destination: 'any' }
        ]
      }
    ]);
  });

  test('Cisco: object groups and trailing keywords', () => {
    const [acl] = parseCiscoAcls(
      sections(['ip access-list extended WEB', ' permit tcp object-group CLIENTS host 10.0.0.80 eq 443 log', ' permit icmp any any echo'])
    );
    assert.deepEqual(acl.rules, [
      { action: 'permit', protocol: 'tcp', source: 'object-group CLIENTS', destination: '10.0.0.80/32', destinationPort: 'eq 443' },
      { action: 'permit', protocol: 'icmp', source: 'any', destination: 'any' }
    ]);
  });

  test('Huawei: named types, basic vs advanced defaults, and layer 2 ACLs skipped', () => {
    const acls = parseHuaweiAcls(
      sections([
        'acl name USERS basic',
        ' rule 5 permit source 10.1.0.0 0.0.255.255',
        'acl name WEB',
        ' rule 5 permit tcp destination-port range 8000 8080',
        'acl number 4000',
        ' rule 5 deny source-mac 0000-0000-0001 ffff-ffff-ffff'
      ])
    );
    assert.deepEqual(acls, [
      {
        name: 'USERS',
        type: 'standard',
        rules: [{ sequence: 5, action: 'permit', protocol: 'ip', source: '10.1.0.0/16', destination: 'any' }]
      },
      {
        name: 'WEB',
        type: 'extended',
        rules: [
          { sequence: 5, action: 'permit', protocol: 'tcp', source: 'any', destination: 'any', destinationPort: 'range 8000 8080' }
        ]
      }
    ]);
  });
});

describe('NAT', () => {
  test('Cisco: prefix-length pools, interface PAT and outside source rules', () => {
    const nat = parseCiscoNat(
      sections([
        'ip nat pool P2 198.51.100.1 198.51.100.6 prefix-length 29',
        'ip nat inside source list NAT_USERS interface GigabitEthernet0/1 overload',
        'ip nat outside source static 203.0.113.9 10.9.9.9',
        'ip nat inside source static network 10.0.0.0 203.0.113.0 /24'
      ])
    );
    assert.deepEqual(nat.pools, [
      { name: 'P2', startAddress: '198.51.100.1', endAddress: '198.51.100.6', subnetMask: '255.255.255.248' }
    ]);
    assert.deepEqual(nat.rules, [
      { type: 'dynamic', direction: 'inside', acl: 'NAT_USERS', interface: 'GigabitEthernet0/1', overload: true },
      // `static network` is not modelled, so it is skipped rather than misreported.
      { type: 'static', direction: 'outside', localAddress: '203.0.113.9', globalAddress: '10.9.9.9' }
    ]);
  });

  test('Cisco: global NAT lines start a new section in a config without indentation', () => {
    const result = parseNetworkConfig(
      ['hostname R1', 'interface Gi0/1', 'ip address 10.0.0.1 255.255.255.0', 'ip nat outside', 'ip nat inside source list 1 interface Gi0/1 overload'].join('\n'),
      'Cisco'
    );
    assert.deepEqual(result.nat.outsideInterfaces, ['Gi0/1']);
    assert.equal(result.nat.rules.length, 1);
  });

  test('Huawei: section-style address groups, no-pat and interface-qualified servers', () => {
    const nat = parseHuaweiNat(
      sections([
        'nat address-group POOL1',
        ' section 0 203.0.113.1 203.0.113.9',
        'interface GigabitEthernet0/0/1',
        ' nat outbound 3000 address-group POOL1 no-pat',
        ' nat server global interface LoopBack0 inside 10.0.0.5'
      ])
    );
    assert.deepEqual(nat, {
      insideInterfaces: [],
      outsideInterfaces: ['GigabitEthernet0/0/1'],
      pools: [{ name: 'POOL1', startAddress: '203.0.113.1', endAddress: '203.0.113.9' }],
      rules: [
        { type: 'dynamic', direction: 'inside', acl: '3000', pool: 'POOL1', interface: 'GigabitEthernet0/0/1', overload: false },
        { type: 'static', direction: 'inside', localAddress: '10.0.0.5', interface: 'LoopBack0' }
      ]
    });
  });
});

describe('routing processes', () => {
  test('Cisco: OSPF VRF processes and interface-only processes', () => {
    const processes = parseCiscoRouting(
      sections(['interface Vlan10', ' ip ospf 2 area 0.0.0.5', 'router ospf 5 vrf RED', ' redistribute bgp 65001 subnets', ' redistribute bgp 65001'])
    );
    assert.deepEqual(processes, [
      {
        protocol: 'ospf',
        processId: 2,
        networks: [],
        interfaces: [{ name: 'Vlan10', area: 5 }],
        redistribute: [],
        defaultOriginate: false
      },
      {
        protocol: 'ospf',
        processId: 5,
        vrf: 'RED',
        networks: [],
        interfaces: [],
        redistribute: ['bgp 65001'],
        defaultOriginate: false
      }
    ]);
  });

  test('Huawei: bare "ospf" is process 1, VPN instance and non-IPv4 families', () => {
    const processes = parseHuaweiRouting(
      sections([
        'ospf vpn-instance BLUE',
        ' area 0',
        '  network 10.0.0.0 0.0.0.255',
        'bgp 64512.1',
        ' ipv6-family unicast',
        '  network 2001:db8:: 32',
        '  import-route direct'
      ])
    );
    assert.deepEqual(processes, [
      {
        protocol: 'ospf',
        processId: 1,
        vrf: 'BLUE',
        networks: [{ address: '10.0.0.0', wildcard: '0.0.0.255', area: 0 }],
        interfaces: [],
        redistribute: [],
        defaultOriginate: false
      },
      { protocol: 'bgp', asNumber: '64512.1', neighbors: [], networks: [], redistribute: [] }
    ]);
  });
});

describe('bundled UI samples', () => {
  const parseSample = (id: string) => parseNetworkConfig(SAMPLE_CONFIGS.find(s => s.id === id)!.rawContent);

  test('switch samples expose their OSPF processes', () => {
    const huawei = parseSample('huawei-core').routingProcesses;
    assert.deepEqual(
      huawei.map(p => p.protocol === 'ospf' && [p.processId, p.routerId, p.networks.length]),
      [[1, '1.1.1.1', 3]]
    );
    const cisco = parseSample('cisco-campus').routingProcesses;
    assert.deepEqual(
      cisco.map(p => p.protocol === 'ospf' && [p.processId, p.routerId, p.networks.map(n => n.area)]),
      [[10, '10.255.255.1', [0, 0, 0]]]
    );
  });

  test('branch router sample exposes its NAT ACL and PAT rule', () => {
    const result = parseSample('cisco-router');
    assert.deepEqual(result.accessLists, [
      { name: 'NAT_USERS', type: 'standard', rules: [{ action: 'permit', protocol: 'ip', source: '172.16.0.0/16', destination: 'any' }] }
    ]);
    assert.deepEqual(result.nat, {
      insideInterfaces: ['GigabitEthernet0/0.10', 'GigabitEthernet0/0.20'],
      outsideInterfaces: ['GigabitEthernet0/1'],
      pools: [],
      rules: [{ type: 'dynamic', direction: 'inside', acl: 'NAT_USERS', interface: 'GigabitEthernet0/1', overload: true }]
    });
    assert.deepEqual(result.routingProcesses, []);
  });
});
