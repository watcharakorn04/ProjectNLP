/// <reference types="node" />
/**
 * Run with: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagramFileName, MAX_CANVAS_SIDE, parseViewBox, pngCanvasSize, resolveSvgSize } from './diagramExport';

describe('buildDiagramFileName', () => {
  test('uses netbot-topology-YYYYMMDD with the format as extension', () => {
    const date = new Date(2026, 0, 5, 23, 59);
    assert.equal(buildDiagramFileName('png', date), 'netbot-topology-20260105.png');
    assert.equal(buildDiagramFileName('svg', date), 'netbot-topology-20260105.svg');
  });

  test('pads two-digit months and days', () => {
    assert.equal(buildDiagramFileName('png', new Date(2026, 11, 31)), 'netbot-topology-20261231.png');
  });
});

describe('parseViewBox', () => {
  test('reads space- or comma-separated values, including negative origins', () => {
    assert.deepEqual(parseViewBox('-8 -8 512.5 300'), { width: 512.5, height: 300 });
    assert.deepEqual(parseViewBox('0,0,100,50'), { width: 100, height: 50 });
  });

  test('rejects missing, malformed and empty boxes', () => {
    for (const value of [null, undefined, '', '0 0 100', '0 0 abc 10', '0 0 0 10', '0 0 10 -5']) {
      assert.equal(parseViewBox(value), null, String(value));
    }
  });
});

describe('resolveSvgSize', () => {
  test('prefers the viewBox over responsive width attributes', () => {
    assert.deepEqual(resolveSvgSize({ viewBox: '0 0 640 480', width: '100%' }), { width: 640, height: 480 });
  });

  test('falls back to absolute width/height, then to a default', () => {
    assert.deepEqual(resolveSvgSize({ width: '300px', height: '200' }), { width: 300, height: 200 });
    assert.deepEqual(resolveSvgSize({ width: '100%', height: 'auto' }), { width: 800, height: 600 });
  });
});

describe('pngCanvasSize', () => {
  test('scales by 2x by default', () => {
    assert.deepEqual(pngCanvasSize({ width: 400, height: 250 }), { width: 800, height: 500 });
  });

  test('shrinks proportionally to stay within the maximum side', () => {
    const size = pngCanvasSize({ width: 10_000, height: 2_000 });
    assert.equal(size.width, MAX_CANVAS_SIDE);
    assert.equal(size.height, Math.round(2_000 * (MAX_CANVAS_SIDE / 10_000)));
  });

  test('never returns a zero dimension', () => {
    assert.deepEqual(pngCanvasSize({ width: 100_000, height: 1 }), { width: MAX_CANVAS_SIDE, height: 1 });
  });
});
