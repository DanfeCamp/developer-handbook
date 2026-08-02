import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '.docusaurus/**',
      'build/**',
      'node_modules/**',
      'static/**',
      'package-lock.json',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: {jsx: true},
      },
    },
    settings: {
      react: {version: 'detect'},
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      // Docusaurus theme components are resolved through webpack aliases, so
      // prop-types validation adds noise without catching real defects.
      'react/prop-types': 'off',
    },
  },

  // Babel config is CommonJS and intentionally uses `module.exports`.
  {
    files: ['babel.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {...globals.node},
    },
  },

  // Keep formatting concerns owned by Prettier; must stay last.
  prettier,
);
