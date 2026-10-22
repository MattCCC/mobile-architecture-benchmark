#!/usr/bin/env node
// Creates the code-signing key pair for remote feature modules once (design §8.10; stand-in for the repository-level
// `make keys`, out/keys/): <dir>/repack-code-signing.pem (RSA 4096, PKCS#1 PEM, private, never committed) and
// <dir>/repack-code-signing.pub (SPKI PEM). The public key is compiled into the host bundle at build time.
// Usage: node candidates/_rn-shared/tools/ensure-signing-keys.mjs <dir>
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? '.');
const priv = join(dir, 'repack-code-signing.pem');
const pub = join(dir, 'repack-code-signing.pub');
if (existsSync(priv) && existsSync(pub)) {
  process.exit(0);
}
mkdirSync(dir, { recursive: true });
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 4096,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});
writeFileSync(priv, privateKey, { mode: 0o600 });
chmodSync(priv, 0o600);
writeFileSync(pub, publicKey);
process.stdout.write(`created code-signing key pair in ${dir}\n`);
