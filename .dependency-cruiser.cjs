/**
 * dependency-cruiser — 아키텍처 의존 규칙 게이트 (yarn validate 편입).
 *
 * CLAUDE.md 의존 방향 규칙을 코드화하여 회귀를 차단한다. ESLint(import/no-cycle,
 * no-restricted-imports, boundaries)와 보완 관계:
 *  - no-resolver-service-to-prisma: Resolver/Service의 PrismaService 직접 접근 금지
 *    (Repository 경유). 이건 기존 ESLint 규칙엔 없던 강제 — depcruise가 추가하는 핵심 가치.
 *  - no-circular / 레이어 방향: 기존 ESLint와 중복되나 도구 비종속 안전망.
 *
 * 데드코드/orphan 탐지는 knip(비차단 리포트)이 담당하므로 여기선 다루지 않는다.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: '순환 의존 금지 (forwardRef는 last resort).',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-resolver-service-to-prisma',
      severity: 'error',
      comment:
        'Resolver/Service는 PrismaService(@/prisma)에 직접 접근 금지 — Repository 경유 (CLAUDE.md 의존 방향).',
      from: { path: '^src/features/.+\\.(resolver|service)\\.ts$' },
      to: { path: '^src/prisma(/|$)' },
    },
    {
      name: 'common-no-upward',
      severity: 'error',
      comment: 'common은 features/global/prisma import 금지 (common → 무의존).',
      from: { path: '^src/common' },
      to: { path: '^src/(features|global|prisma)' },
    },
    {
      name: 'global-no-feat-prisma',
      severity: 'error',
      comment: 'global은 features/prisma import 금지 (global → common, config).',
      from: { path: '^src/global' },
      to: { path: '^src/(features|prisma)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    exclude: { path: '(\\.spec\\.ts$|\\.e2e-spec\\.ts$|(^|/)test/)' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
