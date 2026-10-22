// Module Federation shared dependencies of host and remote: packages with native code or global state are one
// instance, provided eagerly by the host. Versions are the installed (pinned) ones.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const version = (pkg) => require(`${pkg}/package.json`).version;

const SINGLETONS = ['react', 'react-native'];

export function sharedDeps({ eager }) {
  return Object.fromEntries(
    SINGLETONS.map((pkg) => [pkg, { singleton: true, eager, version: version(pkg), requiredVersion: version(pkg) }]),
  );
}
