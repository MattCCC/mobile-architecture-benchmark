import { readFileSync } from 'node:fs';

function globRegex(glob) {
  let out = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      out += '.*';
      i += 1;
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += /[\\^$.[\]|()+{}]/.test(c) ? `\\${c}` : c;
  }
  return new RegExp(`${out}$`);
}

export function zipEntries(path) {
  const b = readFileSync(path);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i -= 1) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP end-of-central-directory not found');
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n += 1) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad ZIP central-directory entry ${n}`);
    const nameLength = b.readUInt16LE(p + 28);
    const extraLength = b.readUInt16LE(p + 30);
    const commentLength = b.readUInt16LE(p + 32);
    entries.push({
      name: b.subarray(p + 46, p + 46 + nameLength).toString('utf8'),
      compressedBytes: b.readUInt32LE(p + 20),
      uncompressedBytes: b.readUInt32LE(p + 24),
    });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function classifyZip(path, rules) {
  const compiled = (rules ?? []).map((r) => ({ ...r, re: globRegex(String(r.glob)) }));
  const totals = {};
  for (const entry of zipEntries(path)) {
    const category = compiled.find((r) => r.re.test(entry.name))?.category ?? 'unclassified';
    const t = totals[category] ??= { entries: 0, compressedBytes: 0, uncompressedBytes: 0 };
    t.entries += 1;
    t.compressedBytes += entry.compressedBytes;
    t.uncompressedBytes += entry.uncompressedBytes;
  }
  return totals;
}

export function benchmarkPayloadTotals(totals) {
  const rows = Object.entries(totals).filter(([category]) => ['benchmark-payload', 'benchmark-data'].includes(category));
  return rows.reduce((out, [, value]) => ({
    entries: out.entries + value.entries,
    compressedBytes: out.compressedBytes + value.compressedBytes,
    uncompressedBytes: out.uncompressedBytes + value.uncompressedBytes,
  }), { entries: 0, compressedBytes: 0, uncompressedBytes: 0 });
}
