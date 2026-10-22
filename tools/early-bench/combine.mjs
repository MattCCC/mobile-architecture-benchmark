#!/usr/bin/env node
// Combine early-bench sessions into one deterministic, descriptive Markdown summary.
// usage: node combine.mjs --in <sessions dir> --out <summary.md> [--invalid-from <json with invalidSessions>] [--exclude a,b]
import { parseArgs } from 'node:util';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { combine, loadSessions, renderSummary } from './lib/combine.mjs';

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      in: { type: 'string' }, out: { type: 'string' }, 'invalid-from': { type: 'string' }, exclude: { type: 'string', default: '' },
    },
    strict: true,
  });
  if (!values.in || !values.out) {
    process.stderr.write('usage: node combine.mjs --in <sessions dir> --out <summary.md> [--invalid-from <file>] [--exclude a,b]\n');
    return 2;
  }
  const invalid = values.exclude.split(',').map((x) => x.trim()).filter(Boolean);
  if (values['invalid-from'] && existsSync(values['invalid-from'])) {
    const j = JSON.parse(readFileSync(values['invalid-from'], 'utf8'));
    for (const x of j.invalidSessions ?? []) {
      invalid.push(typeof x === 'string' ? x : x.sessionId);
    }
  }
  const model = combine(loadSessions(resolve(values.in)), { invalid });
  writeFileSync(resolve(values.out), renderSummary(model));
  process.stdout.write(`${JSON.stringify({ sessionsIncluded: model.included.length, sessionsExcluded: model.excluded.length, cells: model.rows.length })}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
