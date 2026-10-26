import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const nodeGlobals = { process: 'readonly', console: 'readonly', URL: 'readonly', Buffer: 'readonly' };

export default defineConfig([
  globalIgnores(['node_modules/', 'platforms/', 'hooks/', 'build/', 'app/generated/', 'App_Resources/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
    },
  },
  {
    // The NativeScript template wires the platform typings through triple-slash references.
    files: ['references.d.ts'],
    rules: { '@typescript-eslint/triple-slash-reference': 'off' },
  },
  {
    // webpack inlines the bundled fixture JSON through require (the documented JS-bundler path).
    files: ['app/platform/assets.ts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: nodeGlobals, sourceType: 'module' },
  },
  {
    files: ['webpack.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...nodeGlobals, require: 'readonly', module: 'writable', __dirname: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
]);
