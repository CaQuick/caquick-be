// @ts-check
import globals from 'globals';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import boundaries from 'eslint-plugin-boundaries';
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
    plugins: { 'import-x': importX },
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
      'import-x/order': [
        'warn',
        {
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      // 순환 참조 금지 (P2-3). 현재 위반 0건 — 회귀 방지용.
      'import-x/no-cycle': ['error', { ignoreExternal: true }],
    },
    settings: {
      // import-x 권장 방식(resolver-next): 리졸버 인스턴스를 직접 넘긴다.
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          project: path.join(__dirname, 'tsconfig.json'),
        }),
      ],
      // .ts 파싱 설정이 없으면 import 그래프를 만들지 못해 no-cycle이 아무것도
      // 잡지 못한다(마이그레이션 전 eslint-plugin-import 시절부터의 구멍).
      'import-x/parsers': {
        '@typescript-eslint/parser': ['.ts', '.mts', '.cts'],
      },
      // eslint-plugin-boundaries는 eslint-module-utils를 통해 이 키를 읽는다 —
      // import-x로 옮기면서 지우면 `@/` 별칭을 해석하지 못해 경계 강제가
      // 조용히 무력화된다(마이그레이션 중 실제로 재현·확인함). 유지 필수.
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

  // cross-feature 내부 import 금지 (P2-3) — feature 는 다른 feature 를 barrel(index.ts) 로만 import.
  // 같은 feature 내부 import 와 src 루트(app.module/main — 미분류) 의 import 는 검사 대상 아님.
  // 테스트 파일은 통합 테스트 편의상 제외.
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      // mode는 v7에서 deprecated — 'folder'가 기본값이라 생략한다.
      'boundaries/elements': [
        { type: 'common', pattern: 'src/common' },
        { type: 'config', pattern: 'src/config' },
        { type: 'prisma', pattern: 'src/prisma' },
        { type: 'global', pattern: 'src/global' },
        {
          type: 'feature',
          pattern: 'src/features/*',
          capture: ['family'],
        },
      ],
      'boundaries/ignore': ['**/*.spec.ts', '**/*.test.ts'],
    },
    rules: {
      // v7 권장 룰(deprecated entry-point 대체, 이슈 #135). 엔티티 셀렉터로
      // "무엇을(to.element) 어느 파일 경로로(to.file) 가져올 수 있는가"를 기술한다.
      // 같은 element 내부 import는 검사 대상이 아니고(checkInternals 기본 false),
      // src 루트(app.module/main — 미분류)의 import도 검사하지 않는다(기존과 동일).
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            // 공용 레이어는 내부 경로 제한 없이 허용
            {
              from: { element: { type: '*' } },
              allow: {
                to: {
                  element: { types: ['common', 'config', 'prisma', 'global'] },
                },
              },
            },
            // 다른 feature는 배럴(feature 루트의 index.ts)로만.
            // '**/index.ts'가 아니라 경로를 고정한다 — 중첩 index.ts(예:
            // repositories/index.ts)를 통한 우회까지 막기 위함.
            {
              from: { element: { type: '*' } },
              allow: {
                to: {
                  element: { type: 'feature' },
                  file: { path: 'src/features/*/index.ts' },
                },
              },
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
