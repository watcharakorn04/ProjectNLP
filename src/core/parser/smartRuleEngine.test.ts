/// <reference types="node" />
/**
 * Offline feature tables (static routes, ACLs, NAT, OSPF / BGP). Run with: npm run test:parser
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseNetworkConfig } from './cliParser';
import { MOCK_RAW_CONFIGS } from './mockData';
import { MAX_TABLE_ROWS, describeFeatureTopics, detectFeatureTopics } from './smartRuleEngine';

const edge = parseNetworkConfig(MOCK_RAW_CONFIGS.ciscoEdgeRouter);
const border = parseNetworkConfig(MOCK_RAW_CONFIGS.huaweiBorderRouter);
const accessSwitch = parseNetworkConfig(MOCK_RAW_CONFIGS.ciscoAccessSwitch);

describe('feature topic detection', () => {
  test('matches specific features on word boundaries', () => {
    assert.deepEqual(detectFeatureTopics('show me the static routes'), ['staticRoutes']);
    assert.deepEqual(detectFeatureTopics('What does ACL OUTSIDE_IN do?'), ['acl']);
    assert.deepEqual(detectFeatureTopics('list access-lists and NAT rules'), ['nat', 'acl']);
    assert.deepEqual(detectFeatureTopics('eBGP neighbors and OSPF areas'), ['ospf', 'bgp']);
    assert.deepEqual(detectFeatureTopics('ขอดู nat หน่อย'), ['nat']);
    // "destination" contains "nat" and "router" contains "route".
    assert.deepEqual(detectFeatureTopics('which destination does the router use?'), []);
    assert.deepEqual(detectFeatureTopics('hello'), []);
  });

  test('expands generic routing questions to every routing topic', () => {
    assert.deepEqual(detectFeatureTopics('show the routing table'), ['staticRoutes', 'ospf', 'bgp']);
    assert.deepEqual(detectFeatureTopics('มีเส้นทางอะไรบ้าง'), ['staticRoutes', 'ospf', 'bgp']);
    // A specific routing topic wins over the generic expansion.
    assert.deepEqual(detectFeatureTopics('ospf routes'), ['ospf']);
  });
});

describe('feature tables', () => {
  test('static routes show CIDR, next hop, exit interface and default AD', () => {
    const text = describeFeatureTopics(accessSwitch, ['staticRoutes'], false);
    assert.ok(text.startsWith('### 🔍 Parsed details for ACC-SW-3F (Cisco IOS)'));
    assert.ok(text.includes('#### 🧭 Static Routes (2)'));
    assert.ok(text.includes('| Destination | Next hop | Exit interface | AD / Preference | VRF |'));
    assert.ok(text.includes('| `0.0.0.0/0` (default) | `10.3.99.1` | - | 1 (default) | - |'));
    assert.ok(text.includes('| `172.16.0.0/16` | `10.3.99.254` | `GigabitEthernet1/0/48` | 5 | - |'));
  });

  test('Huawei routes use the Huawei default preference and flag NULL0 as discard', () => {
    const text = describeFeatureTopics(parseNetworkConfig(MOCK_RAW_CONFIGS.huaweiAggSwitch), ['staticRoutes'], false);
    assert.ok(text.includes('| `0.0.0.0/0` (default) | `203.0.113.1` | - | 60 (default) | - |'));
    assert.ok(text.includes('| `10.0.0.0/8` | - | `NULL0` (discard) | 250 | - |'));
  });

  test('ACLs get one table each and note when NAT uses them', () => {
    const text = describeFeatureTopics(edge, ['acl'], false);
    assert.ok(text.includes('#### 🛡️ Access Control Lists (3)'));
    assert.ok(text.includes('**ACL `10`** — standard • 2 rules • selects traffic for NAT'));
    assert.ok(text.includes('| - | ✅ permit | ip | `10.1.1.0/24` | `any` |'));
    assert.ok(text.includes('**ACL `OUTSIDE_IN`** — extended • 4 rules'));
    assert.ok(text.includes('| 20 | ✅ permit | tcp | `198.51.100.1/32 eq bgp` | `any` |'));
    assert.ok(text.includes('| 40 | ⛔ deny | ip | `any` | `any` |'));
  });

  test('NAT lists interface roles, pools and translation rules', () => {
    const text = describeFeatureTopics(edge, ['nat'], false);
    assert.ok(text.includes('#### 🔁 NAT (3 rules)'));
    assert.ok(text.includes('- **Inside:** `GigabitEthernet0/0` • **Outside:** `GigabitEthernet0/1`'));
    assert.ok(text.includes('| `PUBLIC` | `203.0.113.10` | `203.0.113.20` | `255.255.255.0` |'));
    assert.ok(text.includes('| PAT | inside | ACL `10` (`10.1.1.0/24`) | pool `PUBLIC` (203.0.113.10 – 203.0.113.20) |'));
    assert.ok(text.includes('| Static NAT | inside | `10.1.1.10` | `203.0.113.5` |'));
    assert.ok(text.includes('| Static NAT (tcp) | inside | `10.1.1.20:80` | address of `GigabitEthernet0/1` : `8080` |'));
  });

  test('Huawei NAT shows Easy IP and the interface each rule is on (Thai)', () => {
    const text = describeFeatureTopics(border, ['nat'], true);
    assert.ok(text.startsWith('### 🔍 รายละเอียดจาก Config ของ BR-RTR-01 (Huawei VRP)'));
    assert.ok(text.includes('| PAT | inside | ACL `3001` (`any`) | IP ของ `GigabitEthernet0/0/2` |'));
    assert.ok(text.includes('pool `1` (203.0.113.10 – 203.0.113.20) บน `GigabitEthernet0/0/0`'));
  });

  test('OSPF and BGP show process facts, areas, neighbors and sessions', () => {
    const text = describeFeatureTopics(edge, ['ospf', 'bgp'], false);
    assert.ok(text.includes('**OSPF 1** — router-id `1.1.1.1` • redistribute `static` • originates a default route'));
    assert.ok(text.includes('| network | `10.1.2.0/24` | 1 |'));
    assert.ok(text.includes('| interface | `GigabitEthernet0/0` | 0 (backbone) |'));
    assert.ok(text.includes('**BGP AS 65001** — router-id `1.1.1.1` • redistribute `connected`'));
    assert.ok(text.includes('| `198.51.100.1` | `64500` | eBGP | ISP-A uplink |'));
    assert.ok(text.includes('| `10.1.1.2` | `65001` | iBGP | - |'));
    assert.ok(text.includes('**Advertised networks:** `203.0.113.0/24`'));
    assert.ok(text.indexOf('OSPF') < text.indexOf('BGP'));
  });

  test('says so when a requested feature is not configured', () => {
    const text = describeFeatureTopics(accessSwitch, ['ospf', 'bgp', 'nat', 'acl'], false);
    assert.match(text, /No OSPF process is configured/);
    assert.match(text, /No BGP process is configured/);
    assert.match(text, /No NAT is configured/);
    assert.match(text, /No ACLs are configured/);
    assert.match(describeFeatureTopics(accessSwitch, ['bgp'], true), /ไม่พบ BGP ใน config/);
  });

  test('caps long tables and escapes pipes in cells', () => {
    const raw = ['hostname R1', ...Array.from({ length: MAX_TABLE_ROWS + 4 }, (_, i) => `ip route 10.${i}.0.0 255.255.0.0 192.0.2.1`)];
    const text = describeFeatureTopics(parseNetworkConfig(raw.join('\n'), 'Cisco'), ['staticRoutes'], false);
    assert.equal(text.split('\n').filter(line => line.startsWith('| `10.')).length, MAX_TABLE_ROWS);
    assert.match(text, /…and 4 more rows/);

    const bgp = parseNetworkConfig(['router bgp 1', ' neighbor 192.0.2.1 remote-as 2', ' neighbor 192.0.2.1 description a|b'].join('\n'), 'Cisco');
    assert.ok(describeFeatureTopics(bgp, ['bgp'], false).includes('| eBGP | a\\|b |'));
  });
});
