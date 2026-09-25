/**
 * Mock CLI configs with their expected parser output.
 *
 * - Import `MOCK_PARSED_CONFIGS` in UI components to render without running the parser.
 * - `cliParser.test.ts` asserts `parseNetworkConfig(MOCK_RAW_CONFIGS[k])` deep-equals `MOCK_PARSED_CONFIGS[k]`,
 *   so these fixtures always reflect real parser behaviour.
 */
import { ExtractedNetworkConfig, NatConfig } from './types';

export type MockConfigKey = 'ciscoAccessSwitch' | 'huaweiAggSwitch' | 'ciscoEdgeRouter' | 'huaweiBorderRouter';

const NO_NAT: NatConfig = { insideInterfaces: [], outsideInterfaces: [], pools: [], rules: [] };

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
return`,

  ciscoEdgeRouter: `hostname EDGE-RTR-01
!
interface GigabitEthernet0/0
 description LAN
 ip address 10.1.1.1 255.255.255.0
 ip nat inside
 ip ospf 1 area 0
!
interface GigabitEthernet0/1
 description ISP-A
 ip address 198.51.100.2 255.255.255.252
 ip nat outside
 ip access-group OUTSIDE_IN in
!
router ospf 1
 router-id 1.1.1.1
 network 10.1.2.0 0.0.0.255 area 0.0.0.1
 redistribute static subnets
 default-information originate
!
router bgp 65001
 bgp router-id 1.1.1.1
 neighbor ISP peer-group
 neighbor ISP remote-as 64500
 neighbor 198.51.100.1 peer-group ISP
 neighbor 198.51.100.1 description ISP-A uplink
 neighbor 10.1.1.2 remote-as 65001
 !
 address-family ipv4
  network 203.0.113.0 mask 255.255.255.0
  redistribute connected
  neighbor 198.51.100.1 activate
 exit-address-family
 !
 address-family ipv4 vrf GUEST
  network 172.16.0.0
 exit-address-family
!
ip nat pool PUBLIC 203.0.113.10 203.0.113.20 netmask 255.255.255.0
ip nat inside source list 10 pool PUBLIC overload
ip nat inside source static 10.1.1.10 203.0.113.5
ip nat inside source static tcp 10.1.1.20 80 interface GigabitEthernet0/1 8080
!
ip route 0.0.0.0 0.0.0.0 198.51.100.1 250
!
access-list 10 permit 10.1.1.0 0.0.0.255
access-list 10 deny any
access-list 101 permit tcp any host 203.0.113.5 eq 443
access-list 101 deny ip 10.0.0.0 0.255.0.255 any log
!
ip access-list extended OUTSIDE_IN
 remark allow web and bgp
 10 permit tcp any host 203.0.113.5 eq www
 20 permit tcp host 198.51.100.1 eq bgp any
 30 permit udp any range 1000 2000 any
 40 deny ip any any
!
end`,

  huaweiBorderRouter: `#
sysname BR-RTR-01
#
acl number 2000
 rule 5 permit source 192.168.1.0 0.0.0.255
 rule 10 deny
#
acl name MGMT advanced
 rule 5 permit tcp source 10.0.0.0 0.0.0.255 destination 10.0.0.1 0 destination-port eq 22
 rule 10 deny ip
#
acl number 3001
 rule permit udp source any destination 192.168.1.53 0 destination-port eq dns
#
nat address-group 1 203.0.113.10 203.0.113.20
#
interface GigabitEthernet0/0/0
 description WAN
 ip address 198.51.100.2 255.255.255.252
 nat outbound 2000 address-group 1
 nat server protocol tcp global current-interface 8080 inside 192.168.1.20 80
#
interface GigabitEthernet0/0/1
 description LAN
 ip address 192.168.1.1 255.255.255.0
 ospf enable 1 area 0.0.0.0
#
interface GigabitEthernet0/0/2
 ip address 100.64.0.2 255.255.255.252
 nat outbound 3001
#
bgp 65010
 router-id 2.2.2.2
 peer 198.51.100.1 as-number 64500
 peer 198.51.100.1 description ISP-B
 group IBGP internal
 peer IBGP as-number 65010
 peer 10.255.0.2 group IBGP
 #
 ipv4-family unicast
  undo synchronization
  network 192.168.1.0 255.255.255.0
  network 10.0.0.0
  import-route direct
  peer 198.51.100.1 enable
#
ospf 1 router-id 2.2.2.2
 default-route-advertise
 import-route static
 area 0.0.0.0
  network 10.0.0.0 0.0.0.255
 area 0.0.0.10
  network 10.10.0.0 0.0.255.255
#
nat static global 203.0.113.30 inside 192.168.1.30
#
ip route-static 0.0.0.0 0.0.0.0 198.51.100.1
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
    accessLists: [],
    nat: NO_NAT,
    routingProcesses: [],
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
    accessLists: [],
    nat: NO_NAT,
    routingProcesses: [],
    meta: { detectedBy: 'auto', confidence: 99, lineCount: 37, warnings: [] }
  },

  ciscoEdgeRouter: {
    hostname: 'EDGE-RTR-01',
    vendor: 'Cisco IOS',
    vlans: [],
    interfaces: [
      {
        name: 'GigabitEthernet0/0',
        description: 'LAN',
        shutdown: false,
        ipAddress: '10.1.1.1',
        subnetMask: '255.255.255.0',
        mode: 'routed'
      },
      {
        name: 'GigabitEthernet0/1',
        description: 'ISP-A',
        shutdown: false,
        ipAddress: '198.51.100.2',
        subnetMask: '255.255.255.252',
        mode: 'routed'
      }
    ],
    sviGateways: [],
    staticRoutes: [{ destination: '0.0.0.0', mask: '0.0.0.0', nextHop: '198.51.100.1', distance: 250 }],
    accessLists: [
      {
        name: '10',
        type: 'standard',
        rules: [
          { action: 'permit', protocol: 'ip', source: '10.1.1.0/24', destination: 'any' },
          { action: 'deny', protocol: 'ip', source: 'any', destination: 'any' }
        ]
      },
      {
        name: '101',
        type: 'extended',
        rules: [
          { action: 'permit', protocol: 'tcp', source: 'any', destination: '203.0.113.5/32', destinationPort: 'eq 443' },
          // Non-contiguous wildcard: kept as address + wildcard.
          { action: 'deny', protocol: 'ip', source: '10.0.0.0 0.255.0.255', destination: 'any' }
        ]
      },
      {
        name: 'OUTSIDE_IN',
        type: 'extended',
        rules: [
          { sequence: 10, action: 'permit', protocol: 'tcp', source: 'any', destination: '203.0.113.5/32', destinationPort: 'eq www' },
          { sequence: 20, action: 'permit', protocol: 'tcp', source: '198.51.100.1/32', sourcePort: 'eq bgp', destination: 'any' },
          { sequence: 30, action: 'permit', protocol: 'udp', source: 'any', sourcePort: 'range 1000 2000', destination: 'any' },
          { sequence: 40, action: 'deny', protocol: 'ip', source: 'any', destination: 'any' }
        ]
      }
    ],
    nat: {
      insideInterfaces: ['GigabitEthernet0/0'],
      outsideInterfaces: ['GigabitEthernet0/1'],
      pools: [{ name: 'PUBLIC', startAddress: '203.0.113.10', endAddress: '203.0.113.20', subnetMask: '255.255.255.0' }],
      rules: [
        { type: 'dynamic', direction: 'inside', acl: '10', pool: 'PUBLIC', overload: true },
        { type: 'static', direction: 'inside', localAddress: '10.1.1.10', globalAddress: '203.0.113.5' },
        {
          type: 'static',
          direction: 'inside',
          protocol: 'tcp',
          localAddress: '10.1.1.20',
          localPort: '80',
          globalPort: '8080',
          interface: 'GigabitEthernet0/1'
        }
      ]
    },
    routingProcesses: [
      {
        protocol: 'ospf',
        processId: 1,
        routerId: '1.1.1.1',
        networks: [{ address: '10.1.2.0', wildcard: '0.0.0.255', area: 1 }],
        interfaces: [{ name: 'GigabitEthernet0/0', area: 0 }],
        redistribute: ['static'],
        defaultOriginate: true
      },
      {
        protocol: 'bgp',
        asNumber: '65001',
        routerId: '1.1.1.1',
        neighbors: [
          { address: '198.51.100.1', remoteAs: '64500', description: 'ISP-A uplink' },
          { address: '10.1.1.2', remoteAs: '65001' }
        ],
        // The VRF GUEST address family's network is not global IPv4 unicast.
        networks: [{ address: '203.0.113.0', mask: '255.255.255.0' }],
        redistribute: ['connected']
      }
    ],
    meta: { detectedBy: 'auto', confidence: 99, lineCount: 58, warnings: [] }
  },

  huaweiBorderRouter: {
    hostname: 'BR-RTR-01',
    vendor: 'Huawei VRP',
    vlans: [],
    interfaces: [
      {
        name: 'GigabitEthernet0/0/0',
        description: 'WAN',
        shutdown: false,
        ipAddress: '198.51.100.2',
        subnetMask: '255.255.255.252',
        mode: 'routed'
      },
      {
        name: 'GigabitEthernet0/0/1',
        description: 'LAN',
        shutdown: false,
        ipAddress: '192.168.1.1',
        subnetMask: '255.255.255.0',
        mode: 'routed'
      },
      { name: 'GigabitEthernet0/0/2', shutdown: false, ipAddress: '100.64.0.2', subnetMask: '255.255.255.252', mode: 'routed' }
    ],
    sviGateways: [],
    staticRoutes: [{ destination: '0.0.0.0', mask: '0.0.0.0', nextHop: '198.51.100.1' }],
    accessLists: [
      {
        name: '2000',
        type: 'standard',
        rules: [
          { sequence: 5, action: 'permit', protocol: 'ip', source: '192.168.1.0/24', destination: 'any' },
          { sequence: 10, action: 'deny', protocol: 'ip', source: 'any', destination: 'any' }
        ]
      },
      {
        name: 'MGMT',
        type: 'extended',
        rules: [
          {
            sequence: 5,
            action: 'permit',
            protocol: 'tcp',
            source: '10.0.0.0/24',
            destination: '10.0.0.1/32',
            destinationPort: 'eq 22'
          },
          { sequence: 10, action: 'deny', protocol: 'ip', source: 'any', destination: 'any' }
        ]
      },
      {
        name: '3001',
        type: 'extended',
        rules: [{ action: 'permit', protocol: 'udp', source: 'any', destination: '192.168.1.53/32', destinationPort: 'eq dns' }]
      }
    ],
    nat: {
      insideInterfaces: [],
      outsideInterfaces: ['GigabitEthernet0/0/0', 'GigabitEthernet0/0/2'],
      pools: [{ name: '1', startAddress: '203.0.113.10', endAddress: '203.0.113.20' }],
      rules: [
        { type: 'dynamic', direction: 'inside', acl: '2000', pool: '1', interface: 'GigabitEthernet0/0/0', overload: true },
        {
          type: 'static',
          direction: 'inside',
          protocol: 'tcp',
          localAddress: '192.168.1.20',
          localPort: '80',
          globalPort: '8080',
          interface: 'GigabitEthernet0/0/0'
        },
        // Easy IP: no address group, so the interface address is used.
        { type: 'dynamic', direction: 'inside', acl: '3001', interface: 'GigabitEthernet0/0/2', overload: true },
        { type: 'static', direction: 'inside', localAddress: '192.168.1.30', globalAddress: '203.0.113.30' }
      ]
    },
    routingProcesses: [
      {
        protocol: 'ospf',
        processId: 1,
        routerId: '2.2.2.2',
        networks: [
          { address: '10.0.0.0', wildcard: '0.0.0.255', area: 0 },
          { address: '10.10.0.0', wildcard: '0.0.255.255', area: 10 }
        ],
        interfaces: [{ name: 'GigabitEthernet0/0/1', area: 0 }],
        redistribute: ['static'],
        defaultOriginate: true
      },
      {
        protocol: 'bgp',
        asNumber: '65010',
        routerId: '2.2.2.2',
        neighbors: [
          { address: '198.51.100.1', remoteAs: '64500', description: 'ISP-B' },
          { address: '10.255.0.2', remoteAs: '65010' }
        ],
        networks: [
          { address: '192.168.1.0', mask: '255.255.255.0' },
          { address: '10.0.0.0', mask: '255.0.0.0' }
        ],
        redistribute: ['connected']
      }
    ],
    meta: { detectedBy: 'auto', confidence: 99, lineCount: 59, warnings: [] }
  }
};
