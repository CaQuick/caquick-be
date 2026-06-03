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
      // 순환 참조 금지 (P2-3). 현재 위반 0건 — 회귀 방지용.
      'import/no-cycle': ['error', { ignoreExternal: true }],
    },
    settings: {
      'import/resolver': {
        typescript: { project: path.join(__dirname, 'tsconfig.json') },
      },
    },
  },

  // 모듈 경계 강화 (P2-3) — CLAUDE.md 의존성 방향 룰을 ESLint 로 강제.
  // common 은 features/global/prisma 에 의존 금지 (common → 무의존).
  {
    files: ['src/common/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/features',
                '@/features/**',
                '@/global',
                '@/global/**',
                '@/prisma',
                '@/prisma/**',
              ],
              message:
                'common 은 features/global/prisma 에 의존하면 안 됩니다 (common → 무의존).',
            },
          ],
        },
      ],
    },
  },

  // common/utils 는 순수 함수 — DI(Injectable/Inject)·ConfigService·Prisma 의존 금지.
  // (DI 없는 값 클래스인 HttpException 류는 허용)
  {
    files: ['src/common/utils/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@nestjs/common',
              importNames: ['Injectable', 'Inject'],
              message:
                'common/utils 는 DI-free 순수 함수만 (Injectable/Inject 금지).',
            },
            {
              name: '@nestjs/config',
              message:
                'common/utils 는 ConfigService 등 런타임 서비스에 의존하면 안 됩니다.',
            },
          ],
          patterns: [
            {
              group: [
                '@/features',
                '@/features/**',
                '@/global',
                '@/global/**',
                '@/prisma',
                '@/prisma/**',
              ],
              message:
                'common 은 features/global/prisma 에 의존하면 안 됩니다 (common → 무의존).',
            },
          ],
        },
      ],
    },
  },

  // global 은 features/prisma 에 의존 금지 (global → common, config).
  {
    files: ['src/global/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features', '@/features/**', '@/prisma', '@/prisma/**'],
              message:
                'global 은 features/prisma 에 의존하면 안 됩니다 (global → common, config).',
            },
          ],
        },
      ],
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
