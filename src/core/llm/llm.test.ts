/// <reference types="node" />
/**
 * Run with: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGeminiRequest,
  closeOpenFence,
  createSseParser,
  extractMermaid,
  parseGeminiStreamChunk,
  redactSecrets,
  REDACTED,
  splitFencedBlocks,
  toGeminiHistory
} from './index';
import { configSourceFromSample, loadConfigSource } from '../configLoader';
import { SAMPLE_CONFIGS } from '../../utils/sampleConfigs';
import type { ChatMessage } from '../../types/chat';

describe('createSseParser', () => {
  test('emits data payloads regardless of chunk boundaries', () => {
    const stream = 'data: {"a":1}\r\n\r\ndata: {"b":2}\n\n: keep-alive\n\ndata: {"c":3}\r\n\r\n';
    for (let size = 1; size <= stream.length; size++) {
      const parser = createSseParser();
      const events: string[] = [];
      for (let i = 0; i < stream.length; i += size) events.push(...parser.push(stream.slice(i, i + size)));
      events.push(...parser.flush());
      assert.deepEqual(events, ['{"a":1}', '{"b":2}', '{"c":3}'], `chunk size ${size}`);
    }
  });

  test('joins multi-line data and flushes an unterminated final event', () => {
    const parser = createSseParser();
    assert.deepEqual(parser.push('event: message\ndata: line1\ndata:line2\n\ndata: tail'), ['line1\nline2']);
    assert.deepEqual(parser.flush(), ['tail']);
  });
});

describe('parseGeminiStreamChunk', () => {
  test('extracts visible text, finish reason and usage, skipping thought parts', () => {
    const chunk = parseGeminiStreamChunk({
      candidates: [
        {
          content: { role: 'model', parts: [{ text: 'thinking…', thought: true }, { text: 'Hello ' }, { text: 'world' }] },
          finishReason: 'STOP'
        }
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 }
    });
    assert.equal(chunk.text, 'Hello world');
    assert.equal(chunk.finishReason, 'STOP');
    assert.deepEqual(chunk.usage, { promptTokens: 10, outputTokens: 2, totalTokens: 12 });
  });

  test('surfaces streamed errors and prompt blocks', () => {
    assert.deepEqual(parseGeminiStreamChunk({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' } }).error, {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      message: 'quota'
    });
    assert.equal(parseGeminiStreamChunk({ promptFeedback: { blockReason: 'SAFETY' } }).blockReason, 'SAFETY');
    assert.equal(parseGeminiStreamChunk(null).text, '');
  });
});

describe('splitFencedBlocks / extractMermaid', () => {
  const diagram = 'graph TD\n  A["Core"] --> B["VLAN 10"]';

  test('splits prose and closed blocks', () => {
    const segments = splitFencedBlocks(`Intro\n\`\`\`mermaid\n${diagram}\n\`\`\`\nOutro`);
    assert.deepEqual(segments, [
      { type: 'text', content: 'Intro\n' },
      { type: 'code', lang: 'mermaid', code: diagram, closed: true },
      { type: 'text', content: '\nOutro' }
    ]);
  });

  test('never reports an unclosed block as complete, at any streaming prefix', () => {
    const full = `### Topology\n\`\`\`mermaid\n${diagram}\n\`\`\`\nDone.`;
    const closeAt = full.lastIndexOf('```') + 3;
    for (let i = 0; i <= full.length; i++) {
      const { latestComplete, pending } = extractMermaid(full.slice(0, i));
      if (i < closeAt) {
        assert.equal(latestComplete, null, `prefix ${i}`);
      } else {
        assert.equal(latestComplete, diagram, `prefix ${i}`);
        assert.equal(pending, null, `prefix ${i}`);
      }
    }
    assert.equal(extractMermaid(full.slice(0, full.indexOf('-->'))).pending, 'graph TD\n  A["Core"]');
  });

  test('closeOpenFence terminates a truncated block so appended notes stay outside it', () => {
    const truncated = `Intro\n\`\`\`mermaid\n${diagram}`;
    const closed = closeOpenFence(truncated);
    assert.equal(extractMermaid(`${closed}\n\n**Stopped**`).latestComplete, diagram);
    assert.equal(closeOpenFence('No fences here'), 'No fences here');
    assert.equal(closeOpenFence(closed), closed);
  });

  test('returns the last complete diagram and ignores other languages', () => {
    const text = '```mermaid\ngraph TD\nA-->B\n```\n```cisco\nshow run\n```\n```mermaid\ngraph LR\nC-->D\n```';
    assert.equal(extractMermaid(text).latestComplete, 'graph LR\nC-->D');
  });
});

describe('redactSecrets', () => {
  test('hides credential values but keeps the command and its type', () => {
    const raw = [
      'enable secret 5 $1$abcd$Q9e',
      'username admin privilege 15 secret 9 $9$xyz',
      ' password 7 0822455D0A16',
      'snmp-server community s3cr3t RO',
      'crypto isakmp key MyPsk address 10.0.0.1',
      ' ip ospf message-digest-key 1 md5 OspfKey',
      ' local-user admin password irreversible-cipher $1a$hash$',
      'snmp-agent community read cipher %^%#abc',
      ' authentication-mode password',
      'service password-encryption',
      'crypto key generate rsa modulus 2048'
    ].join('\n');

    assert.equal(
      redactSecrets(raw),
      [
        `enable secret 5 ${REDACTED}`,
        `username admin privilege 15 secret 9 ${REDACTED}`,
        ` password 7 ${REDACTED}`,
        `snmp-server community ${REDACTED} RO`,
        `crypto isakmp key ${REDACTED} address 10.0.0.1`,
        ` ip ospf message-digest-key 1 md5 ${REDACTED}`,
        ` local-user admin password irreversible-cipher ${REDACTED}`,
        `snmp-agent community read cipher ${REDACTED}`,
        ' authentication-mode password',
        'service password-encryption',
        'crypto key generate rsa modulus 2048'
      ].join('\n')
    );
  });
});

describe('buildGeminiRequest', () => {
  const loaded = loadConfigSource(configSourceFromSample(SAMPLE_CONFIGS[0]));
  assert.ok(loaded.ok);
  const file = loaded.file;

  const msg = (sender: ChatMessage['sender'], text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
    id: `${sender}_${text}`,
    sender,
    timestamp: '10:00',
    text,
    ...extra
  });

  test('quick action payload carries the task, parsed JSON and raw CLI in the final user turn', () => {
    const body = buildGeminiRequest({ language: 'TH', file, history: [], action: 'topology' });
    const finalTurn = body.contents[body.contents.length - 1];

    assert.equal(finalTurn.role, 'user');
    const text = finalTurn.parts[0].text;
    assert.match(text, /Task: Draw the logical network topology/);
    assert.match(text, /<parsed_config_json>/);
    assert.match(text, /<raw_cli>/);
    assert.ok(text.includes(`"hostname": ${JSON.stringify(file.parsedData!.hostname)}`));

    const json = text.slice(text.indexOf('<parsed_config_json>') + 20, text.indexOf('</parsed_config_json>'));
    assert.equal(JSON.parse(json).coreParser.hostname, file.extractedConfig!.hostname);
    assert.match(body.systemInstruction.parts[0].text, /Thai/);
  });

  test('history is trimmed to alternating turns that start with the user and skip errors', () => {
    const history = [
      msg('assistant', 'Welcome'),
      msg('user', 'Q1'),
      msg('assistant', 'oops', { metadata: { isError: true } }),
      msg('assistant', 'A1'),
      msg('assistant', 'A1 continued'),
      msg('user', 'Q2 unanswered')
    ];
    assert.deepEqual(toGeminiHistory(history), [
      { role: 'user', parts: [{ text: 'Q1' }] },
      { role: 'model', parts: [{ text: 'A1\n\nA1 continued' }] },
      { role: 'user', parts: [{ text: 'Q2 unanswered' }] }
    ]);

    const body = buildGeminiRequest({ language: 'EN', file: null, history, userText: 'Q3' });
    assert.deepEqual(
      body.contents.map((c) => c.role),
      ['user', 'model', 'user']
    );
    assert.match(body.contents[2].parts[0].text, /Question: Q3/);
    assert.match(body.contents[2].parts[0].text, /No configuration file is loaded/);
  });
});
