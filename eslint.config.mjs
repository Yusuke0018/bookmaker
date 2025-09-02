// ESLint flat config (ESLint v9)
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    files: ['**/*.{js,ts,mjs,cjs}'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      'no-console': 'off',
    },
  },
];
