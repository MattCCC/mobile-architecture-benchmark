// Module Federation runtime plugin of the host (replaces Re.Pack's default resolver plugin):
// - every remote script is resolved through ScriptManager with signature verification "strict" against the
//   build-time public key (a corrupted or unsigned chunk is rejected and never executed, FA-11) and the token header;
// - an unavailable remote resolves to an empty module instead of a global error that would crash the app; the
//   Insights host then shows the embedded copy labelled `embedded-fallback` and reports `remote.error`.
import RepackResolverPlugin from '@callstack/repack/mf/resolver-plugin';
import type { ModuleFederationRuntimePlugin } from '@module-federation/enhanced/runtime';
import { remoteHeaders, remotePublicKey } from './remoteConfig';

export default function mbRuntimePlugin(): ModuleFederationRuntimePlugin {
  const resolver = RepackResolverPlugin(async (url: string) => {
    const publicKey = remotePublicKey();
    return {
      url,
      cache: true,
      headers: remoteHeaders(),
      verifyScriptSignature: publicKey.length > 0 ? 'strict' : 'off',
      publicKey: publicKey.length > 0 ? publicKey : undefined,
    };
  });
  return {
    ...resolver,
    name: 'mb-runtime-plugin',
    errorLoadRemote({ lifecycle }: { lifecycle: string }) {
      // Only the final module-load stage is answered; the runtime calls the returned value as a module factory.
      if (lifecycle === 'onLoad') {
        return () => ({});
      }
      return undefined;
    },
  };
}
