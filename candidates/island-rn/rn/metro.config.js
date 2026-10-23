// Metro configuration of the island bundle. The shared island UI (../../_island-rn-ui), the shared RN UI
// (../../_rn-shared) and the island BenchKit forwarder (linked into node_modules) live outside this project and have
// no node_modules of their own: every bare import from those files resolves from this project's node_modules.
const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const projectRoot = __dirname;
const rnShared = path.resolve(projectRoot, '../../_rn-shared');
const islandUi = path.resolve(projectRoot, '../../_island-rn-ui');
const sharedRoots = [rnShared, islandUi];

const aliases = {
  '@mobilebench/rn-ui': path.join(rnShared, 'ui/src'),
  '@mobilebench/island-ui': path.join(islandUi, 'src'),
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
const inShared = (file) => sharedRoots.some((root) => file.startsWith(root + path.sep));

const config = {
  watchFolders: sharedRoots,
  resolver: {
    nodeModulesPaths: [path.resolve(projectRoot, 'node_modules')],
    resolveRequest: (context, moduleName, platform) => {
      const aliased = aliasFor(moduleName);
      if (aliased !== null) {
        return context.resolveRequest(context, aliased, platform);
      }
      if (isBare(moduleName) && inShared(context.originModulePath)) {
        // Resolve shared code's bare imports as if they were imported from this project.
        return context.resolveRequest(
          { ...context, originModulePath: path.join(projectRoot, 'package.json') },
          moduleName,
          platform,
        );
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
