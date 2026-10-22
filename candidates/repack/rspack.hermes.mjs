// Hermes bytecode for the Insights remote, compiled inside the compilation so that Re.Pack's CodeSigningPlugin
// (processAssets stage ANALYSE) signs the bytecode that is actually served.
// Re.Pack 5.4.2's HermesBytecodePlugin compiles on `assetEmitted`, i.e. after signing: hermesc drops the trailing
// signature comment, every remote chunk then ships unsigned and fails `verifyScriptSignature: "strict"`.
// Same hermesc (the `hermes-compiler` package next to react-native, as Re.Pack resolves it) and flags
// (-w -O -output-source-map) as Re.Pack's plugin; no source maps are shipped with the remote.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const PLUGIN = 'MbHermesBeforeSigningPlugin';

export function hermesCliPath(projectRoot) {
  const require = createRequire(path.join(projectRoot, 'package.json'));
  const reactNativeDir = path.dirname(require.resolve('react-native/package.json'));
  const osBin = { darwin: 'osx-bin', linux: 'linux64-bin', win32: 'win64-bin' }[process.platform];
  const exe = process.platform === 'win32' ? 'hermesc.exe' : 'hermesc';
  return path.join(reactNativeDir, '..', 'hermes-compiler', 'hermesc', osBin, exe);
}

export class HermesBeforeSigningPlugin {
  /** @param {{ enabled: boolean, hermesc: string, test: RegExp }} options */
  constructor(options) {
    this.options = options;
  }

  apply(compiler) {
    if (!this.options.enabled) {
      return;
    }
    const { Compilation, sources } = compiler.webpack;
    compiler.hooks.thisCompilation.tap(PLUGIN, (compilation) => {
      compilation.hooks.processAssets.tap(
        // After minification and source-map tooling, before CodeSigningPlugin (ANALYSE).
        { name: PLUGIN, stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE },
        () => {
          const dir = mkdtempSync(path.join(tmpdir(), 'mb-hermes-'));
          try {
            for (const asset of compilation.getAssets()) {
              if (!this.options.test.test(asset.name)) {
                continue;
              }
              const input = path.join(dir, 'in.js');
              const output = path.join(dir, 'out.hbc');
              writeFileSync(input, asset.source.buffer());
              // -output-source-map as in RN's own bundle step and Re.Pack's plugin: it moves the debug info out
              // of the bytecode (about 30% smaller); the map is written to the temp dir and not shipped.
              execFileSync(this.options.hermesc, ['-w', '-O', '-emit-binary', '-out', output, '-output-source-map', input], {
                stdio: ['ignore', 'ignore', 'pipe'],
              });
              compilation.updateAsset(asset.name, new sources.RawSource(readFileSync(output)));
            }
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      );
    });
  }
}
