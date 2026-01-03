// @ts-check
import globals from 'globals';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import { defineConfig } from 'eslint/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(
  { 
    ignores: [
      'eslint.config.mjs',
      'ecosystem.config.js',
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '.yarn/**',
      'src/graphql/graphql.types.ts'
    ]
  },

  ...tseslint.configs.recommendedTypeChecked.map((cfg) => ({
    ...cfg,
    files: ['**/*.ts'],
  })),

  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    plugins: { import: importPlugin },
    rules: {
      'prettier/prettier': ["error", { "endOfLine": "auto" }],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
          args: 'after-used',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      'import/order': [
        'warn',
        {
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
    settings: {
      'import/resolver': {
        typescript: { project: path.join(__dirname, 'tsconfig.json') },
      },
    },
  },

  // 테스트 파일에 대한 특별 규칙
  {
    files: ['**/*.spec.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  prettierRecommended,
);
