// Host bundle of the `repack` candidate (Re.Pack 5 + Rspack 1). Insights is registered at run time as a Module
// Federation 2 remote (src/InsightsRoute.tsx); the embedded copy stays in this bundle as the fallback.
import path from 'node:path';
import * as Repack from '@callstack/repack';
import rspack from '@rspack/core';
import { jsRule, projectRoot, publicKeyText, resolveOptions } from './rspack.common.mjs';
import { sharedDeps } from './mf.shared.mjs';

export default Repack.defineRspackConfig(() => ({
  context: projectRoot,
  entry: './index.js',
  resolve: resolveOptions(),
  module: {
    rules: [jsRule(), ...Repack.getAssetTransformRules()],
  },
  plugins: [
    new Repack.RepackPlugin(),
    new Repack.plugins.ModuleFederationPluginV2({
      name: 'MbHost',
      filename: 'MbHost.container.js.bundle',
      dts: false,
      shared: sharedDeps({ eager: true }),
      // Re.Pack's core and prefetch plugins; the resolver is replaced by src/mfRuntimePlugin.ts
      // (strict signature verification, token header, fallback on load errors).
      defaultRuntimePlugins: ['@callstack/repack/mf/core-plugin', '@callstack/repack/mf/prefetch-plugin'],
      runtimePlugins: [path.resolve(projectRoot, 'src/mfRuntimePlugin.ts')],
    }),
    new rspack.DefinePlugin({ __MB_REMOTE_PUBLIC_KEY__: JSON.stringify(publicKeyText()) }),
    // Optional peer of @react-navigation/elements that this app does not install.
    new rspack.IgnorePlugin({ resourceRegExp: /^@react-native-masked-view/ }),
  ],
}));
