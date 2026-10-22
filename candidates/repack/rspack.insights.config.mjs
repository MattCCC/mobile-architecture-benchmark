// Insights remote (Module Federation 2 container), built and served independently of the installed app:
//   build/remote/<platform>/<version>/  mf-manifest.json + MbInsights container + chunks (Hermes bytecode, signed)
// Served by the local server at /v1/modules/repack/<platform>/<version>/ (design §15.2).
// MB_REMOTE_VERSION (default 1) is compiled into the module and reported by `remote.ready v=<version>`.
import { existsSync } from 'node:fs';
import path from 'node:path';
import * as Repack from '@callstack/repack';
import rspack from '@rspack/core';
import { jsRule, projectRoot, resolveOptions, signingPrivateKey } from './rspack.common.mjs';
import { HermesBeforeSigningPlugin, hermesCliPath } from './rspack.hermes.mjs';
import { sharedDeps } from './mf.shared.mjs';

export default Repack.defineRspackConfig((env) => {
  const { platform, mode } = env;
  const version = process.env.MB_REMOTE_VERSION ?? '1';
  const remoteDir = path.resolve(projectRoot, `build/remote/${platform}/${version}`);
  return {
    context: projectRoot,
    entry: './insights-remote/index.js',
    // The served chunks are Hermes bytecode; a JS source map would not describe them.
    devtool: false,
    resolve: resolveOptions(),
    output: {
      path: path.resolve(projectRoot, `build/remote-bundle/${platform}`),
      uniqueName: 'MbInsights',
    },
    module: {
      rules: [jsRule(), ...Repack.getAssetTransformRules({ inline: true })],
    },
    plugins: [
      new Repack.RepackPlugin({
        extraChunks: [{ include: /.*/, type: 'remote', outputPath: remoteDir }],
      }),
      new Repack.plugins.ModuleFederationPluginV2({
        name: 'MbInsights',
        filename: 'MbInsights.container.js.bundle',
        exposes: { './InsightsView': './insights-remote/InsightsRemote.tsx' },
        dts: false,
        shared: sharedDeps({ eager: false }),
      }),
      // Bytecode before signing (see rspack.hermes.mjs: Re.Pack's HermesBytecodePlugin would run after signing).
      new HermesBeforeSigningPlugin({
        enabled: mode === 'production',
        hermesc: hermesCliPath(projectRoot),
        test: /\.(js)?bundle$/,
      }),
      new Repack.plugins.CodeSigningPlugin({
        enabled: existsSync(signingPrivateKey),
        privateKeyPath: signingPrivateKey,
      }),
      new rspack.DefinePlugin({ __MB_REMOTE_VERSION__: JSON.stringify(version) }),
    ],
  };
});
