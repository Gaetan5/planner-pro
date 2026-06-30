const { FlatCompat } = require('@eslint/eslintrc');
const js = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const prettier = require('eslint-plugin-prettier');
const prettierConfig = require('eslint-config-prettier');

const compat = new FlatCompat();

module.exports = [
  js.configs.recommended,
  ...compat.extends('plugin:@typescript-eslint/recommended', 'plugin:prettier/recommended'),
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ['./backend/tsconfig.json', './frontend/tsconfig.json'],
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      prettier: prettier,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      'prettier/prettier': 'error',
    },
  },
  prettierConfig,
];
