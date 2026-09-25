/// <reference types="node" />
/**
 * Run with: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_OUTPUT_TOKENS,
  buildChatRequest,
  closeOpenFence,
  createSseParser,
  extractMermaid,
  hasVerifiedKey,
  isGroqKeyFormat,
  parseOpenAiStreamChunk,
  redactSecrets,
  REDACTED,
  splitFencedBlocks,
  toChatHistory
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

describe('buildChatRequest', () => {
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
    const body = buildChatRequest({ language: 'TH', file, history: [], action: 'topology' });
    const finalTurn = body.messages[body.messages.length - 1];

    assert.equal(finalTurn.role, 'user');
    const text = finalTurn.content;
    assert.match(text, /Task: Draw the logical network topology/);
    assert.match(text, /<parsed_config_json>/);
    assert.match(text, /<raw_cli>/);
    assert.ok(text.includes(`"hostname": ${JSON.stringify(file.parsedData!.hostname)}`));

    const json = text.slice(text.indexOf('<parsed_config_json>') + 20, text.indexOf('</parsed_config_json>'));
    assert.equal(JSON.parse(json).coreParser.hostname, file.extractedConfig!.hostname);
    assert.equal(body.messages[0].role, 'system');
    assert.match(body.messages[0].content, /Thai/);
    assert.equal(body.temperature, 0.2);
    assert.equal(body.max_completion_tokens, MAX_OUTPUT_TOKENS);
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
    assert.deepEqual(toChatHistory(history), [
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1\n\nA1 continued' },
      { role: 'user', content: 'Q2 unanswered' }
    ]);

    // The unanswered user turn is dropped so two user turns never follow each other.
    const body = buildChatRequest({ language: 'EN', file: null, history, userText: 'Q3' });
    assert.deepEqual(
      body.messages.map((m) => m.role),
      ['system', 'user', 'assistant', 'user']
    );
    assert.equal(body.messages[2].content, 'A1\n\nA1 continued');
    assert.match(body.messages[3].content, /Question: Q3/);
    assert.match(body.messages[3].content, /No configuration file is loaded/);
    assert.equal(body.temperature, 0.4);
  });
});

describe('parseOpenAiStreamChunk', () => {
  test('extracts the text delta', () => {
    const chunk = parseOpenAiStreamChunk({
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' }, finish_reason: null }]
    });
    assert.deepEqual(chunk, { text: 'Hello', finishReason: undefined, usage: undefined });
  });

  test('passes finish reasons through and reads Groq usage', () => {
    const chunk = parseOpenAiStreamChunk({
      choices: [{ index: 0, delta: {}, finish_reason: 'length' }],
      x_groq: { id: 'req_1', usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }
    });
    assert.equal(chunk.text, '');
    assert.equal(chunk.finishReason, 'length');
    assert.deepEqual(chunk.usage, { promptTokens: 100, outputTokens: 20, totalTokens: 120 });

    assert.equal(parseOpenAiStreamChunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }).finishReason, 'stop');
    assert.equal(parseOpenAiStreamChunk({ choices: [{ delta: {}, finish_reason: 'content_filter' }] }).finishReason, 'content_filter');
  });

  test('surfaces error bodies and tolerates junk', () => {
    assert.deepEqual(
      parseOpenAiStreamChunk({ error: { message: 'Invalid API Key', type: 'invalid_request_error', code: 'invalid_api_key' } }).error,
      { message: 'Invalid API Key', type: 'invalid_request_error', code: 'invalid_api_key' }
    );
    assert.equal(parseOpenAiStreamChunk(null).text, '');
    assert.equal(parseOpenAiStreamChunk({ choices: 'nope' }).text, '');
  });
});

describe('Groq key helpers', () => {
  test('isGroqKeyFormat accepts only gsk_ keys', () => {
    assert.equal(isGroqKeyFormat('  gsk_abc123 '), true);
    assert.equal(isGroqKeyFormat('gsk_'), false);
    assert.equal(isGroqKeyFormat('AIzaSyExample'), false);
    assert.equal(isGroqKeyFormat('sk-something-else'), false);
    assert.equal(isGroqKeyFormat(''), false);
  });

  test('hasVerifiedKey requires a key whose validation succeeded', () => {
    assert.equal(hasVerifiedKey({ apiKey: 'gsk_key', status: 'valid' }), true);
    assert.equal(hasVerifiedKey({ apiKey: 'gsk_key', status: 'invalid' }), false);
    assert.equal(hasVerifiedKey({ apiKey: 'gsk_key', status: 'validating' }), false);
    assert.equal(hasVerifiedKey({ apiKey: '', status: 'valid' }), false);
  });
});
