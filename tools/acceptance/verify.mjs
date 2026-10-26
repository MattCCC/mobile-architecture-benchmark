#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { verifyAcceptanceReceipt } from './lib.mjs';

const { values } = parseArgs({ options: {
  receipt: { type: 'string' }, candidate: { type: 'string' }, platform: { type: 'string' },
  artifact: { type: 'string' }, design: { type: 'string' },
}, strict: true });
if (!values.receipt || !values.candidate || !values.platform || !values.artifact || !values.design) {
  process.stderr.write('usage: verify.mjs --receipt FILE --candidate ID --platform android|ios --artifact SHA256 --design SHA256\n');
  process.exit(2);
}
const result = verifyAcceptanceReceipt(values.receipt, {
  candidateId: values.candidate, platform: values.platform, artifactSha256: values.artifact, designSha256: values.design,
});
if (!result.ok) {
  process.stderr.write(`${result.problems.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`ok: acceptance receipt ${result.sha256}\n`);
