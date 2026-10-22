// Shared Rspack settings of the host (rspack.config.mjs) and the Insights remote (rspack.insights.config.mjs).
// The shared RN UI (../_rn-shared/ui) and the BenchKit wrapper live outside this project without node_modules of
// their own; this app's node_modules come first so every bare import resolves to the pinned versions here.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Repack from '@callstack/repack';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = __dirname;
export const sharedRoot = path.resolve(__dirname, '../_rn-shared');
export const keysDir = process.env.MB_REMOTE_KEYS_DIR ?? path.resolve(sharedRoot, '.keys');
export const signingPrivateKey = path.join(keysDir, 'repack-code-signing.pem');
export const signingPublicKey = path.join(keysDir, 'repack-code-signing.pub');

export function resolveOptions() {
  return {
    ...Repack.getResolveOptions({ enablePackageExports: true }),
    alias: {
      '@mobilebench/rn-ui': path.resolve(sharedRoot, 'ui/src'),
      '@mobilebench/fixtures': path.resolve(__dirname, '.mb-assets/fixtures'),
      '@mobilebench/stream': path.resolve(__dirname, '.mb-assets/stream'),
    },
    modules: [path.resolve(__dirname, 'node_modules'), 'node_modules'],
  };
}

export function jsRule() {
  return {
    // No include/exclude: shared code outside the project must be transpiled too.
    test: /\.[cm]?[jt]sx?$/,
    type: 'javascript/auto',
    use: { loader: '@callstack/repack/babel-swc-loader', parallel: true, options: {} },
  };
}

/** The PEM public key compiled into the host bundle (empty if the key pair has not been created). */
export function publicKeyText() {
  return existsSync(signingPublicKey) ? readFileSync(signingPublicKey, 'utf8') : '';
}
