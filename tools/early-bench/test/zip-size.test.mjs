import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { benchmarkPayloadTotals, classifyZip, zipEntries } from '../lib/zip-size.mjs';

function centralOnlyZip(entries) {
  const records = entries.map(({ name, compressed, uncompressed }) => {
    const n = Buffer.from(name);
    const b = Buffer.alloc(46 + n.length);
    b.writeUInt32LE(0x02014b50, 0); b.writeUInt32LE(compressed, 20); b.writeUInt32LE(uncompressed, 24);
    b.writeUInt16LE(n.length, 28); n.copy(b, 46);
    return b;
  });
  const central = Buffer.concat(records);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(0, 16);
  return Buffer.concat([central, end]);
}

test('ZIP central-directory sizes are classified without extraction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zip-size-'));
  try {
    const path = join(dir, 'app.apk');
    writeFileSync(path, centralOnlyZip([
      { name: 'assets/fixtures/a.json', compressed: 60, uncompressed: 100 },
      { name: 'classes.dex', compressed: 200, uncompressed: 300 },
    ]));
    assert.equal(zipEntries(path).length, 2);
    const totals = classifyZip(path, [{ glob: 'assets/fixtures/**', category: 'benchmark-payload' }]);
    assert.deepEqual(benchmarkPayloadTotals(totals), { entries: 1, compressedBytes: 60, uncompressedBytes: 100 });
    assert.equal(totals.unclassified.compressedBytes, 200);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
