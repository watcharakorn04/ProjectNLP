/// <reference types="node" />
/**
 * Deterministic offline topology diagrams. Run with: npm run test:parser
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseNetworkConfig } from './cliParser';
import { MOCK_RAW_CONFIGS } from './mockData';
import { MAX_DIAGRAM_NODES_PER_GROUP, escapeMermaidLabel, generateTopologyMermaid, inferDeviceRole } from './diagramGenerator';
import { isInSubnet, networkAddress } from './utils';
import { SAMPLE_CONFIGS } from '../../utils/sampleConfigs';

const diagramOf = (raw: string) => generateTopologyMermaid(parseNetworkConfig(raw));
const sample = (id: string) => SAMPLE_CONFIGS.find(s => s.id === id)!.rawContent;

describe('topology diagram', () => {
  test('draws SVIs, trunks and the default route via its connected SVI', () => {
    const code = diagramOf(MOCK_RAW_CONFIGS.ciscoAccessSwitch);
    assert.ok(code.startsWith('graph TD\n'));
    assert.ok(code.includes('DEV{{"⚡ ACC-SW-3F<br/>Cisco IOS • L3 Switch"}}'));
    assert.ok(code.includes('SVI0["📂 VLAN 10 (Staff)<br/>10.3.10.0/24"]'));
    assert.ok(code.includes('DEV ---|"SVI Vlan99<br/>GW 10.3.99.2"| SVI1'));
    assert.ok(code.includes('TRK0["🔲 Uplink to Core<br/>VLANs 10,20,30-32<br/>native 99"]'));
    assert.ok(code.includes('DEV ===|"Trunk GigabitEthernet1/0/48"| TRK0'));
    // 10.3.99.1 is in Vlan99's subnet, so the next hop hangs off that SVI.
    assert.ok(code.includes('GW0["🌐 Next hop<br/>10.3.99.1"]'));
    assert.ok(code.includes('SVI1 --- GW0'));
    assert.ok(code.includes('GW0 -.->|"0.0.0.0/0"| WAN'));
    // Only the default route is drawn, not the 172.16.0.0/16 static route.
    assert.doesNotMatch(code, /172\.16/);
  });

  test('draws routed IP interfaces and marks shutdown links as dashed', () => {
    const code = diagramOf(MOCK_RAW_CONFIGS.huaweiAggSwitch);
    assert.ok(code.includes('DEV -.-|"SVI Vlanif200<br/>GW 172.20.200.1<br/>(shutdown)"| SVI1'));
    assert.ok(code.includes('NET0["🔗 WAN Uplink<br/>203.0.113.0/30"]'));
    assert.ok(code.includes('NET0 --- GW0'));
    assert.ok(code.includes('TRK0["🔲 Neighbor switch<br/>VLANs 100,200-203<br/>native 200"]'));
  });

  test('shows router-on-a-stick sub-interfaces and the default route AD', () => {
    const code = diagramOf(sample('cisco-router'));
    assert.ok(code.includes('Branch-RTR-01<br/>Cisco IOS • Router'));
    assert.ok(code.includes('DEV ---|"dot1Q GigabitEthernet0/0.10<br/>GW 172.16.10.1"| SVI0'));
    assert.ok(diagramOf(MOCK_RAW_CONFIGS.ciscoEdgeRouter).includes('GW0 -.->|"0.0.0.0/0 (AD 250)"| WAN'));
  });

  test('links the next hop straight from the device when no connected subnet contains it', () => {
    const code = diagramOf(['hostname R1', 'ip route 0.0.0.0 0.0.0.0 192.0.2.1', 'ip route 0.0.0.0 0.0.0.0 Dialer1 200'].join('\n'));
    assert.ok(code.includes('DEV ---|"uplink"| GW0'));
    assert.ok(code.includes('DEV -.->|"0.0.0.0/0 via Dialer1"| WAN'));
  });

  test('still returns a valid diagram when there is nothing to draw', () => {
    const code = diagramOf('hostname EMPTY-SW');
    assert.ok(code.includes('EMPTY["No SVIs, IP interfaces, trunks or default routes found"]'));
    assert.ok(code.includes('DEV -.- EMPTY'));
  });

  test('collapses large groups into a "+N more" node', () => {
    const raw = ['hostname BIG'];
    for (let i = 1; i <= MAX_DIAGRAM_NODES_PER_GROUP + 2; i++) {
      raw.push(`interface GigabitEthernet0/${i}`, ' switchport mode trunk');
    }
    const code = diagramOf(raw.join('\n'));
    assert.equal(code.match(/^ {4}TRK\d+\[/gm)?.length, MAX_DIAGRAM_NODES_PER_GROUP);
    assert.ok(code.includes('TRKMore["… +2 more trunks"]'));
  });

  test('escapes config text so it cannot break out of a label', () => {
    assert.equal(escapeMermaidLabel('a"]; click X "js" <img> #1 | `b` & c'), 'a#quot;]; click X #quot;js#quot; #lt;img#gt; #35;1 #124; #96;b#96; #38; c');
    const code = diagramOf(['hostname R"1', 'interface Gi0/1', ' description x"] --> Y["<b>', ' ip address 10.0.0.1 255.255.255.0'].join('\n'));
    assert.ok(code.includes('R#quot;1'));
    assert.ok(code.includes('NET0["🔗 x#quot;] --#gt; Y[#quot;#lt;b#gt;<br/>10.0.0.0/24"]'));
  });
});

describe('device role and subnet helpers', () => {
  test('infers router, switch and L3 switch roles', () => {
    assert.equal(inferDeviceRole(parseNetworkConfig(MOCK_RAW_CONFIGS.ciscoEdgeRouter)), 'Router');
    assert.equal(inferDeviceRole(parseNetworkConfig(MOCK_RAW_CONFIGS.huaweiAggSwitch)), 'L3 Switch');
    assert.equal(inferDeviceRole(parseNetworkConfig(sample('cisco-router'))), 'Router');
    assert.equal(inferDeviceRole(parseNetworkConfig('hostname SW\ninterface Gi0/1\n switchport mode access', 'Cisco')), 'Switch');
  });

  test('computes network addresses and subnet membership', () => {
    assert.equal(networkAddress('10.3.99.2', '255.255.255.0'), '10.3.99.0');
    assert.equal(networkAddress('198.51.100.2', '255.255.255.252'), '198.51.100.0');
    assert.ok(isInSubnet('198.51.100.1', '198.51.100.2', '255.255.255.252'));
    assert.ok(!isInSubnet('198.51.100.5', '198.51.100.2', '255.255.255.252'));
    assert.ok(!isInSubnet('Dialer1', '198.51.100.2', '255.255.255.252'));
  });
});
