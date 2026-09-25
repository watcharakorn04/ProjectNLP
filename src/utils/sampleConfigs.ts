export interface SampleConfig {
  id: string;
  name: string;
  vendor: 'Huawei VRP' | 'Cisco IOS';
  fileName: string;
  description: string;
  rawContent: string;
}

export const SAMPLE_CONFIGS: SampleConfig[] = [
  {
    id: 'huawei-core',
    name: 'Huawei S5700 Core Switch (VRP)',
    vendor: 'Huawei VRP',
    fileName: 'huawei_core_switch.txt',
    description: 'Layer 3 Enterprise Core Switch with VLANs 10, 20, 30, Vlanif gateways, OSPF, and trunk ports.',
    rawContent: `! Software Version V200R019C00SPC500
#
sysname Core-Switch-01
#
vlan batch 10 20 30 99
#
dhcp enable
#
interface Vlanif10
 description Management & IT Subnet
 ip address 192.168.10.1 255.255.255.0
 dhcp select interface
#
interface Vlanif20
 description Staff & Engineering Subnet
 ip address 192.168.20.1 255.255.255.0
 dhcp select interface
#
interface Vlanif30
 description Guest WiFi Subnet
 ip address 192.168.30.1 255.255.255.0
#
interface Vlanif99
 description Native Network Transit
 ip address 10.0.99.1 255.255.255.252
#
interface GigabitEthernet0/0/1
 description Uplink to Access Switch 01
 port link-type trunk
 port trunk allow-pass vlan 10 20 30
#
interface GigabitEthernet0/0/2
 description Uplink to Access Switch 02
 port link-type trunk
 port trunk allow-pass vlan 10 20 30
#
interface GigabitEthernet0/0/24
 description Link to Edge Firewall
 port link-type access
 port default vlan 99
#
ospf 1 router-id 1.1.1.1
 area 0.0.0.0
  network 192.168.10.0 0.0.0.255
  network 192.168.20.0 0.0.0.255
  network 10.0.99.0 0.0.0.3
#
ip route-static 0.0.0.0 0.0.0.0 10.0.99.2
#
user-interface vty 0 4
 authentication-mode aaa
 user privilege level 15
 protocol inbound ssh
#
return`
  },
  {
    id: 'cisco-campus',
    name: 'Cisco Catalyst 3850 Campus Switch (IOS-XE)',
    vendor: 'Cisco IOS',
    fileName: 'cisco_campus_switch.txt',
    description: 'Layer 3 Distribution Switch with VLAN 10, 20, 100, SVI Gateways, OSPF process 10, and Trunks.',
    rawContent: `! Current Configuration: 1842 bytes
version 16.9
service timestamps debug datetime msec
service timestamps log datetime msec
service password-encryption
!
hostname Campus-Dist-SW01
!
boot-start-marker
boot-end-marker
!
vlan 10
 name Corporate_Data
!
vlan 20
 name VoIP_Phones
!
vlan 100
 name Server_Farm
!
ip routing
!
interface GigabitEthernet1/0/1
 description Trunk to Floor-1 Access Switch
 switchport trunk encapsulation dot1q
 switchport mode trunk
 switchport trunk allowed vlan 10,20
!
interface GigabitEthernet1/0/2
 description Trunk to Floor-2 Access Switch
 switchport trunk encapsulation dot1q
 switchport mode trunk
 switchport trunk allowed vlan 10,20
!
interface GigabitEthernet1/0/24
 description Server Farm Host 1
 switchport mode access
 switchport access vlan 100
 spanning-tree portfast
!
interface Vlan10
 description Gateway for Corporate Data
 ip address 10.10.10.1 255.255.255.0
 no shutdown
!
interface Vlan20
 description Gateway for VoIP Network
 ip address 10.10.20.1 255.255.255.0
 no shutdown
!
interface Vlan100
 description Gateway for Servers
 ip address 10.10.100.1 255.255.255.0
 no shutdown
!
router ospf 10
 router-id 10.255.255.1
 network 10.10.10.0 0.0.0.255 area 0
 network 10.10.20.0 0.0.0.255 area 0
 network 10.10.100.0 0.0.0.255 area 0
!
ip route 0.0.0.0 0.0.0.0 10.10.100.254
!
line con 0
 stopbits 1
line vty 0 4
 transport input ssh
 login local
!
end`
  },
  {
    id: 'cisco-router',
    name: 'Cisco 2911 Branch Router (IOS)',
    vendor: 'Cisco IOS',
    fileName: 'cisco_branch_router.txt',
    description: 'Branch WAN router with 802.1Q sub-interfaces (Router-on-a-Stick), NAT, and ACL configuration.',
    rawContent: `! Last configuration change at 14:12:05 UTC
version 15.4
hostname Branch-RTR-01
!
ip domain-name enterprise.net
!
interface GigabitEthernet0/0
 no ip address
 duplex auto
 speed auto
 no shutdown
!
interface GigabitEthernet0/0.10
 description Internal Office Data
 encapsulation dot1Q 10
 ip address 172.16.10.1 255.255.255.0
 ip nat inside
!
interface GigabitEthernet0/0.20
 description Internal Guest Network
 encapsulation dot1Q 20
 ip address 172.16.20.1 255.255.255.0
 ip nat inside
!
interface GigabitEthernet0/1
 description WAN Connection to ISP
 ip address 203.0.113.14 255.255.255.248
 ip nat outside
!
ip access-list standard NAT_USERS
 permit 172.16.0.0 0.0.255.255
!
ip nat inside source list NAT_USERS interface GigabitEthernet0/1 overload
!
ip route 0.0.0.0 0.0.0.0 203.0.113.9
!
end`
  }
];
