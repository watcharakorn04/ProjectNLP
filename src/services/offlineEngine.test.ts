/// <reference types="node" />
/**
 * Offline replies built from the core parser's routing / NAT / ACL data. Run with: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateOfflineResponse } from './offlineEngine';
import { MAX_ACL_ROWS, auditFeatures, describeFeatures } from './offlineFeatures';
import { MOCK_RAW_CONFIGS, parseNetworkConfig } from '../core/parser';
import { parseNetworkConfig as parseLegacyConfig } from '../utils/networkParser';
import type { SupportedLanguage } from '../types/chat';
import type { QuickActionType } from '../core/llm';

const reply = (raw: string, intent: QuickActionType | undefined, language: SupportedLanguage = 'EN') =>
  generateOfflineResponse({
    prompt: 'hello',
    intent,
    language,
    parsedConfig: parseLegacyConfig(raw),
    extractedConfig: parseNetworkConfig(raw)
  }).text;

describe('offline summary', () => {
  test('renders structured routing, NAT and ACL sections instead of raw routing lines', () => {
    const text = reply(MOCK_RAW_CONFIGS.ciscoEdgeRouter, 'summary');

    assert.match(text, /#### 🧭 Routing\n/);
    assert.ok(text.includes('`0.0.0.0/0 → 198.51.100.1` (AD 250)'));
    assert.ok(text.includes('**OSPF 1**: router-id `1.1.1.1`; network `10.1.2.0/24 area 1`; interfaces `GigabitEthernet0/0 area 0`'));
    assert.ok(text.includes('`198.51.100.1` (AS 64500, ISP-A uplink)'));
    assert.ok(text.includes('- **Inside:** `GigabitEthernet0/0` • **Outside:** `GigabitEthernet0/1`'));
    assert.ok(text.includes('- **PAT**: ACL `10` → pool `PUBLIC`'));
    assert.ok(text.includes('- **Static NAT** tcp: `10.1.1.20:80` ↔ `GigabitEthernet0/1:8080`'));
    assert.ok(text.includes('| OUTSIDE_IN | extended | 20 | permit | tcp | 198.51.100.1/32 eq bgp | any |'));
    // The legacy raw-line routing list is replaced, not duplicated.
    assert.doesNotMatch(text, /Routing Protocols|\*\*Static\*\*: `ip route/);
  });

  test('Thai summary uses Thai labels and keeps technical terms in English', () => {
    const text = reply(MOCK_RAW_CONFIGS.huaweiBorderRouter, 'summary', 'TH');
    assert.match(text, /#### 🧭 การตั้งค่า Routing/);
    assert.ok(text.includes('- **PAT**: ACL `2000` → pool `1` บน `GigabitEthernet0/0/0`'));
    assert.ok(text.includes('- **PAT**: ACL `3001` → IP ของ `GigabitEthernet0/0/2`'));
    assert.ok(text.includes('**BGP AS 65010**: router-id `2.2.2.2`'));
  });

  test('says when there is no OSPF / BGP and omits empty NAT and ACL sections', () => {
    const text = describeFeatures(parseNetworkConfig(MOCK_RAW_CONFIGS.ciscoAccessSwitch), false);
    assert.match(text, /No dynamic routing protocol \(OSPF \/ BGP\)/);
    assert.doesNotMatch(text, /NAT|Access Control Lists/);
  });

  test('caps the ACL table', () => {
    const raw = Array.from({ length: MAX_ACL_ROWS + 3 }, (_, i) => `access-list 10 permit host 10.0.0.${i}`).join('\n');
    const text = describeFeatures(parseNetworkConfig(raw, 'Cisco'), false);
    assert.equal(text.split('\n').filter(line => line.startsWith('| 10 |')).length, MAX_ACL_ROWS);
    assert.match(text, /…and 3 more rules/);
  });
});

describe('offline security audit', () => {
  test('flags permit-any-any rules and static NAT exposure with evidence', () => {
    const raw = [
      'hostname R1',
      'interface GigabitEthernet0/1',
      ' ip address 198.51.100.2 255.255.255.252',
      ' ip nat outside',
      'ip access-list extended WAN_IN',
      ' 10 permit tcp any host 203.0.113.5 eq 443',
      ' 20 permit ip any any',
      'ip nat inside source static tcp 10.0.0.5 22 198.51.100.2 2222'
    ].join('\n');
    const text = reply(raw, 'security');

    assert.match(text, /#### 🔎 ACL \/ NAT \/ Routing Checks/);
    assert.ok(text.includes('**High** – ACL `WAN_IN` rule 20 permits all IP traffic'));
    assert.ok(text.includes('**Medium** – Static NAT exposes `10.0.0.5:22`'));
    assert.doesNotMatch(text, /No ACLs configured/);
  });

  test('suggests ACLs and routing-protocol authentication when relevant', () => {
    const text = auditFeatures(parseNetworkConfig(MOCK_RAW_CONFIGS.huaweiBorderRouter), false);
    assert.match(text, /Verify every BGP neighbor uses authentication/);
    assert.match(text, /Verify OSPF area \/ interface authentication/);

    const bare = auditFeatures(parseNetworkConfig(MOCK_RAW_CONFIGS.ciscoAccessSwitch), true);
    assert.match(bare, /ไม่พบ ACL/);
  });
});

describe('offline default reply', () => {
  test('includes a routing / NAT / ACL overview line', () => {
    const text = reply(MOCK_RAW_CONFIGS.ciscoEdgeRouter, undefined);
    assert.ok(text.includes('- **Routing / NAT / ACL:** OSPF 1, BGP AS 65001 • 1 static route • 3 NAT rules • 3 ACLs'));
  });

  test('still works with only the legacy parsed config', () => {
    const text = generateOfflineResponse({
      prompt: 'summary',
      language: 'EN',
      parsedConfig: parseLegacyConfig(MOCK_RAW_CONFIGS.ciscoEdgeRouter)
    }).text;
    assert.match(text, /Routing Protocols/);
  });
});
