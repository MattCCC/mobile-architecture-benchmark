// ESLint flat config: Expo's shared config (eslint-config-expo, installed with `npx expo install`).
// The shared RN code (../_rn-shared) has no node_modules: imports resolve from this app's node_modules, and the
// `@mobilebench/*` aliases map to the shared sources (same mapping as metro.config.js and tsconfig.json).
const path = require('path');
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const nodeModules = path.join(__dirname, 'node_modules');

module.exports = defineConfig([
  expoConfig,
  {
    settings: {
      'import/resolver': {
        node: {
          extensions: ['.js', '.jsx', '.ts', '.tsx', '.json', '.mjs', '.cjs'],
          paths: [nodeModules],
        },
      },
      'import/core-modules': ['@mobilebench/rn-ui'],
      react: { version: '19.3' },
    },
  },
  {
    // Bundler-alias imports of generated assets and the ../_rn-shared path alias are resolved by Metro.
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'import/no-unresolved': ['error', { ignore: ['^@mobilebench/(fixtures|stream)/'] }],
    },
  },
  {
    // Node-side configuration files.
    files: ['eslint.config.js', 'metro.config.js', 'plugins/**/*.js'],
    languageOptions: {
      globals: { __dirname: 'readonly', require: 'readonly', module: 'writable', process: 'readonly' },
    },
  },
  {
    ignores: ['android/*', 'ios/*', 'dist/*', '.expo/*', '.mb-assets/*', 'build/*'],
  },
]);
