/**
 * Mock CLI configs with their expected parser output.
 *
 * - Import `MOCK_PARSED_CONFIGS` in UI components to render without running the parser.
 * - `cliParser.test.ts` asserts `parseNetworkConfig(MOCK_RAW_CONFIGS[k])` deep-equals `MOCK_PARSED_CONFIGS[k]`,
 *   so these fixtures always reflect real parser behaviour.
 */
import { ExtractedNetworkConfig } from './types';

export type MockConfigKey = 'ciscoAccessSwitch' | 'huaweiAggSwitch';

export const MOCK_RAW_CONFIGS: Record<MockConfigKey, string> = {
  ciscoAccessSwitch: `hostname ACC-SW-3F
!
vlan 10
 name Staff
!
vlan 20
 name Voice
!
vlan 30-32
!
interface GigabitEthernet1/0/1
 description PC-3F-01
 switchport mode access
 switchport access vlan 10
!
interface GigabitEthernet1/0/2
 description Unused port
 switchport mode access
 switchport access vlan 999
 shutdown
!
interface GigabitEthernet1/0/48
 description Uplink to Core
 switchport mode trunk
 switchport trunk native vlan 99
 switchport trunk allowed vlan 10,20
 switchport trunk allowed vlan add 30-32
!
interface Vlan10
 ip address 10.3.10.1 255.255.255.0
!
interface Vlan99
 description Management
 ip address 10.3.99.2 255.255.255.0
!
ip route 0.0.0.0 0.0.0.0 10.3.99.1
ip route 172.16.0.0 255.255.0.0 GigabitEthernet1/0/48 10.3.99.254 5 name TO_DC
!
end`,

  huaweiAggSwitch: `#
sysname AGG-SW-B1
#
vlan batch 100 200 to 203
#
vlan 100
 description Finance
#
interface Vlanif100
 ip address 172.20.100.1 24
#
interface Vlanif200
 ip address 172.20.200.1 255.255.255.0
 shutdown
#
interface GigabitEthernet0/0/1
 port link-type access
 port default vlan 100
#
interface GigabitEthernet0/0/2
 port link-type trunk
 port trunk pvid vlan 200
 port trunk allow-pass vlan 100 200 to 203
#
interface GigabitEthernet0/0/3
 port link-type hybrid
 port hybrid tagged vlan 201 202
#
interface GigabitEthernet0/0/24
 undo portswitch
 description WAN Uplink
 ip address 203.0.113.2 30
#
ip route-static 0.0.0.0 0 203.0.113.1
ip route-static 10.0.0.0 255.0.0.0 NULL0 preference 250
#
return`
};

export const MOCK_PARSED_CONFIGS: Record<MockConfigKey, ExtractedNetworkConfig> = {
  ciscoAccessSwitch: {
    hostname: 'ACC-SW-3F',
    vendor: 'Cisco IOS',
    vlans: [
      { vlanId: 10, name: 'Staff' },
      { vlanId: 20, name: 'Voice' },
      { vlanId: 30 },
      { vlanId: 31 },
      { vlanId: 32 },
      { vlanId: 99 },
      { vlanId: 999 }
    ],
    interfaces: [
      { name: 'GigabitEthernet1/0/1', description: 'PC-3F-01', shutdown: false, vlan: 10, mode: 'access' },
      { name: 'GigabitEthernet1/0/2', description: 'Unused port', shutdown: true, vlan: 999, mode: 'access' },
      {
        name: 'GigabitEthernet1/0/48',
        description: 'Uplink to Core',
        shutdown: false,
        nativeVlan: 99,
        allowedVlans: '10,20,30-32',
        mode: 'trunk'
      },
      { name: 'Vlan10', shutdown: false, ipAddress: '10.3.10.1', subnetMask: '255.255.255.0', mode: 'routed' },
      {
        name: 'Vlan99',
        description: 'Management',
        shutdown: false,
        ipAddress: '10.3.99.2',
        subnetMask: '255.255.255.0',
        mode: 'routed'
      }
    ],
    sviGateways: [
      { interfaceName: 'Vlan10', ipAddress: '10.3.10.1', subnetMask: '255.255.255.0', vlanId: 10, kind: 'svi' },
      { interfaceName: 'Vlan99', ipAddress: '10.3.99.2', subnetMask: '255.255.255.0', vlanId: 99, kind: 'svi' }
    ],
    staticRoutes: [
      { destination: '0.0.0.0', mask: '0.0.0.0', nextHop: '10.3.99.1' },
      {
        destination: '172.16.0.0',
        mask: '255.255.0.0',
        nextHop: '10.3.99.254',
        outInterface: 'GigabitEthernet1/0/48',
        distance: 5
      }
    ],
    meta: { detectedBy: 'auto', confidence: 99, lineCount: 39, warnings: [] }
  },

  huaweiAggSwitch: {
    hostname: 'AGG-SW-B1',
    vendor: 'Huawei VRP',
    vlans: [
      { vlanId: 100, name: 'Finance' },
      { vlanId: 200 },
      { vlanId: 201 },
      { vlanId: 202 },
      { vlanId: 203 }
    ],
    interfaces: [
      { name: 'Vlanif100', shutdown: false, ipAddress: '172.20.100.1', subnetMask: '255.255.255.0', mode: 'routed' },
      { name: 'Vlanif200', shutdown: true, ipAddress: '172.20.200.1', subnetMask: '255.255.255.0', mode: 'routed' },
      { name: 'GigabitEthernet0/0/1', shutdown: false, vlan: 100, mode: 'access' },
      {
        name: 'GigabitEthernet0/0/2',
        shutdown: false,
        nativeVlan: 200,
        allowedVlans: '100,200-203',
        mode: 'trunk'
      },
      { name: 'GigabitEthernet0/0/3', shutdown: false, allowedVlans: '201-202', mode: 'trunk' },
      {
        name: 'GigabitEthernet0/0/24',
        shutdown: false,
        description: 'WAN Uplink',
        ipAddress: '203.0.113.2',
        subnetMask: '255.255.255.252',
        mode: 'routed'
      }
    ],
    sviGateways: [
      { interfaceName: 'Vlanif100', ipAddress: '172.20.100.1', subnetMask: '255.255.255.0', vlanId: 100, kind: 'svi' },
      { interfaceName: 'Vlanif200', ipAddress: '172.20.200.1', subnetMask: '255.255.255.0', vlanId: 200, kind: 'svi' }
    ],
    staticRoutes: [
      { destination: '0.0.0.0', mask: '0.0.0.0', nextHop: '203.0.113.1' },
      { destination: '10.0.0.0', mask: '255.0.0.0', nextHop: 'NULL0', outInterface: 'NULL0', distance: 250 }
    ],
    meta: { detectedBy: 'auto', confidence: 99, lineCount: 37, warnings: [] }
  }
};
