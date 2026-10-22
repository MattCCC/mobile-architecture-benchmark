import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  fmt,
  groupText,
  itemLabel,
  labelWidth,
  optionText,
  selectionButtonText,
  selectionEntryText,
  summaryCountText,
  summaryTotalText,
} from '../app/core/format';
import { sha256Hex, utf8Bytes } from '../app/core/sha256';

const reference = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

test('sha256 equals node:crypto for every length across the block boundaries', () => {
  for (let n = 0; n <= 200; n += 1) {
    const text = 'abcdefghij'.repeat(30).slice(0, n);
    assert.equal(sha256Hex(text), reference(text), `length ${n}`);
  }
});

test('sha256 equals node:crypto for non-ASCII and large inputs', () => {
  const samples = ['\u00b7', '\u2014', 'Item 042 \u00b7 Option B \u2014 12.34', '\ud83d\ude00 ok', 'a\u0000b'];
  samples.forEach((text) => assert.equal(sha256Hex(text), reference(text)));
  const large = `mb-state-v1\nvalues=${Array.from({ length: 9000 }, (_, i) => 100 + (i % 9900)).join(',')}\n`;
  assert.equal(sha256Hex(large), reference(large));
});

test('utf8Bytes equals Buffer.from(text, "utf8")', () => {
  const text = 'A \u00b7 \u2014 \ud83d\ude00 z';
  assert.deepEqual(Array.from(utf8Bytes(text)), Array.from(Buffer.from(text, 'utf8')));
});

test('fmt formats fixed-point values without locale APIs', () => {
  assert.equal(fmt(100), '1.00');
  assert.equal(fmt(105), '1.05');
  assert.equal(fmt(1234), '12.34');
  assert.equal(fmt(9999), '99.99');
  assert.equal(fmt(191327), '1913.27');
  assert.equal(fmt(2592379), '25923.79');
});

test('labels and texts follow the functional specification', () => {
  assert.equal(labelWidth(30), 3);
  assert.equal(labelWidth(300), 3);
  assert.equal(labelWidth(3000), 4);
  assert.equal(itemLabel(42, 3), 'Item 042');
  assert.equal(itemLabel(7, 4), 'Item 0007');
  assert.equal(itemLabel(2999, 4), 'Item 2999');
  assert.equal(groupText(5), 'Group 5');
  assert.equal(optionText(0, 1234), 'A 12.34');
  assert.equal(optionText(2, 100), 'C 1.00');
  assert.equal(summaryCountText(50), 'Selected 50');
  assert.equal(summaryTotalText(191327), 'Total 1913.27');
  assert.equal(selectionButtonText(50), 'Selection (50)');
  assert.equal(selectionEntryText('Item 042', 1, 1234), 'Item 042 \u00b7 Option B \u2014 12.34');
});
