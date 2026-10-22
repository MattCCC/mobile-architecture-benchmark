// Build-time check of the Insights remote: every served chunk must be Hermes bytecode followed by Re.Pack's
// 1280-byte code-signing section (`/* RCSSB */` + RS256 JWT whose `hash` claim is the SHA-256 of the chunk), and
// the signature must verify against the public key that is compiled into the host. Mirrors what the native
// loaders check with `verifyScriptSignature: "strict"`, so an unsigned or wrongly signed remote fails the build
// instead of silently falling back to the embedded copy on the device.
// Usage: node scripts/verify-remote.mjs <remoteDir> <publicKey.pem>
import { createHash, verify } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, publicKeyPath] = process.argv.slice(2);
const SIGNATURE_SIZE = 1280;
const MARK = Buffer.from('/* RCSSB */');
const HBC_MAGIC = Buffer.from([0xc6, 0x1f, 0xbc, 0x03]);
const publicKey = readFileSync(publicKeyPath, 'utf8');

function problem(bytes) {
  if (!bytes.subarray(0, 4).equals(HBC_MAGIC)) {
    return 'not Hermes bytecode';
  }
  if (bytes.length <= SIGNATURE_SIZE) {
    return 'no signature section';
  }
  const content = bytes.subarray(0, bytes.length - SIGNATURE_SIZE);
  const section = bytes.subarray(bytes.length - SIGNATURE_SIZE);
  if (!section.subarray(0, MARK.length).equals(MARK)) {
    return 'no signature section';
  }
  const token = section.subarray(MARK.length).toString('utf8').replace(/\0+$/, '');
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) {
    return 'malformed token';
  }
  if (JSON.parse(Buffer.from(header, 'base64url').toString('utf8')).alg !== 'RS256') {
    return 'unexpected algorithm';
  }
  if (!verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url'))) {
    return 'signature does not verify with the host public key';
  }
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (claims.hash !== createHash('sha256').update(content).digest('hex')) {
    return 'hash claim does not match the chunk';
  }
  return null;
}

const files = readdirSync(dir).filter((f) => f.endsWith('.bundle')).sort();
const failures = files.map((f) => [f, problem(readFileSync(join(dir, f)))]).filter(([, p]) => p !== null);
for (const [f, p] of failures) {
  process.stderr.write(`verify-remote: ${f}: ${p}\n`);
}
if (files.length === 0 || failures.length > 0) {
  process.stderr.write(`verify-remote: FAILED (${failures.length} of ${files.length} chunks)\n`);
  process.exit(1);
}
process.stdout.write(`verify-remote: ${files.length} chunks are Hermes bytecode, signed, and verify with the host key\n`);
