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
    files: ['**/*.cjs', '**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      'no-undef': 'off',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        tsconfigRootDir: __dirname,
        project: [
          './backend/tsconfig.json',
          './backend/prisma/tsconfig.json',
          './tsconfig.eslint.json',
          './backend/tests/tsconfig.json',
          './frontend/tsconfig.json',
        ],
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
  {
    files: ['backend/tests/**/*.ts', 'backend/src/**/*.spec.ts', 'backend/prisma/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: false,
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        describe: 'readonly',
        expect: 'readonly',
        it: 'readonly',
        jest: 'readonly',
        test: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
  prettierConfig,
];
