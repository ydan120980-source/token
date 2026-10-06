'use strict';

const path = require('node:path');
const js = require('@eslint/js');
const globals = require('globals');
const { includeIgnoreFile } = require('@eslint/compat');

module.exports = [
  // Respect .gitignore (node_modules, dist, build, tmp, _site, .agents, .claude, data, …)
  includeIgnoreFile(path.resolve(__dirname, '.gitignore')),
  // Third-party chart distribution stays unchanged and outside application lint.
  { ignores: ['design/desktop-reference/assets/**'] },

  js.configs.recommended,

  {
    // Node CommonJS modules and UMD helpers.
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, window: 'readonly', self: 'readonly' },
    },
  },

  {
    // Renderer runs in the browser; UMD modules also touch module/window
    files: ['design/desktop-reference/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
  },

  {
    // Adjust recommended rules to the codebase's intentional idioms
    rules: {
      // CLI/terminal output parsing legitimately needs ANSI (\x1b) and NUL (\x00)
      'no-control-regex': 'off',
      // Best-effort defensive catches are deliberate
      'no-empty': ['error', { allowEmptyCatch: true }],
      // `_` is the throwaway-placeholder convention here
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        // Rest-destructuring to omit keys (e.g. redacting account identity) is deliberate
        ignoreRestSiblings: true,
      }],
    },
  },
];
