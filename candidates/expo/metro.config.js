// Metro configuration (Expo). The shared RN UI (../_rn-shared/ui) and the BenchKit wrapper
// (../_rn-shared/rn-benchkit, linked into node_modules) live outside this project and have no node_modules of
// their own: every bare import from those files resolves from this app's node_modules, so both RN-family hosts
// bundle the same shared code against their own pinned dependencies.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../_rn-shared');
const assetsRoot = path.resolve(projectRoot, '.mb-assets');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [sharedRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

const aliases = {
  '@mobilebench/rn-ui': path.resolve(sharedRoot, 'ui/src'),
  '@mobilebench/fixtures': path.resolve(assetsRoot, 'fixtures'),
  '@mobilebench/stream': path.resolve(assetsRoot, 'stream'),
};

function aliasFor(moduleName) {
  for (const [prefix, target] of Object.entries(aliases)) {
    if (moduleName === prefix || moduleName.startsWith(`${prefix}/`)) {
      return target + moduleName.slice(prefix.length);
    }
  }
  return null;
}

const isBare = (name) => !name.startsWith('.') && !name.startsWith('/');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const aliased = aliasFor(moduleName);
  if (aliased !== null) {
    return context.resolveRequest(context, aliased, platform);
  }
  if (isBare(moduleName) && context.originModulePath.startsWith(sharedRoot + path.sep)) {
    // Resolve shared code's bare imports as if they were imported from this app.
    return context.resolveRequest(
      { ...context, originModulePath: path.join(projectRoot, 'package.json') },
      moduleName,
      platform,
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
