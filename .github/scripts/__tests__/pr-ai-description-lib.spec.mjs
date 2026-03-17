import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExcludeGlobs,
  buildLimitedDiff,
  decideCompareFallback,
  filterDiffFiles,
  filterKnownLabels,
  renderSummaryBlock,
  upsertSummaryBlock,
  validateAiSummaryJson,
} from '../pr-ai-description-lib.mjs';

test('기본 제외 패턴과 추가 패턴이 파일 필터링에 적용된다', () => {
  const files = [
    { filename: 'yarn.lock', patch: '@@ -1 +1 @@' },
    { filename: 'src/main.ts', patch: '@@ -1 +1 @@' },
    { filename: 'dist/main.js', patch: '@@ -1 +1 @@' },
    { filename: 'snapshots/user.snap', patch: '@@ -1 +1 @@' },
    { filename: 'logs/error.log', patch: '@@ -1 +1 @@' },
  ];

  const excludeGlobs = buildExcludeGlobs('logs/**');
  const result = filterDiffFiles(files, excludeGlobs);

  assert.equal(result.included.length, 1);
  assert.equal(result.included[0].filename, 'src/main.ts');
  assert.equal(result.excludedFilesCount, 4);
});

test('Diff 절단 시 메타가 계산되고 최종 bytes가 한도를 넘지 않는다', () => {
  const entries = [
    { filename: 'src/a.ts', status: 'modified', patch: 'line\n'.repeat(15) },
    { filename: 'src/b.ts', status: 'modified', patch: 'line\n'.repeat(15) },
    { filename: 'src/c.ts', status: 'modified', patch: 'line\n'.repeat(15) },
  ];

  const limited = buildLimitedDiff(entries, 230);

  assert.equal(limited.meta.totalFiles, 3);
  assert.equal(limited.meta.truncated, true);
  assert.ok(limited.meta.includedFiles < 3);
  assert.ok(limited.meta.finalBytes <= 230);
  assert.match(limited.diffText, /# diff-truncation-meta/);
});

test('JSON schema 검증 성공/실패를 구분한다', () => {
  const validPayload = {
    title: 'feat: 사용자 조회 API 개선',
    summary: '응답 필드와 예외 처리를 정리했습니다.',
    summaryBullets: ['조회 조건 검증 로직 추가', '에러 응답 포맷 통일'],
    changes: [
      {
        file: 'src/user/user.service.ts',
        description: '조회 조건 검증 로직 추가',
      },
    ],
    impact: ['API 응답 형식 변경으로 클라이언트 확인 필요'],
    checklist: ['resolver 통합 테스트 확인'],
    breakingChanges: [],
    relatedIssues: [],
    dependencies: [],
    labels: ['backend', 'api'],
  };

  const validated = validateAiSummaryJson(validPayload);
  assert.equal(validated.title, validPayload.title);
  assert.deepEqual(validated.labels, ['backend', 'api']);
  assert.deepEqual(validated.summaryBullets, validPayload.summaryBullets);
  assert.equal(validated.changes[0].file, 'src/user/user.service.ts');

  assert.throws(
    () =>
      validateAiSummaryJson({
        ...validPayload,
        unknown: 'x',
      }),
    /invalid-root-additional-property/,
  );

  assert.throws(
    () =>
      validateAiSummaryJson({
        ...validPayload,
        changes: [{ file: '', description: 'test' }],
      }),
    /invalid-changes-0-file/,
  );
});

test('마커 블록이 있으면 교체하고 없으면 하단에 추가한다', () => {
  const summary = {
    title: 'fix: 인증 가드 수정',
    summary: '요약',
    summaryBullets: ['가드 로직 개선'],
    changes: [{ file: 'src/auth/auth.guard.ts', description: '가드 수정' }],
    impact: ['인증 플로우 변경으로 테스트 확인 필요'],
    checklist: ['테스트 실행'],
    breakingChanges: [],
    relatedIssues: [],
    dependencies: [],
    labels: [],
  };

  const block = renderSummaryBlock(summary);

  const bodyWithoutMarker = '기존 본문';
  const appended = upsertSummaryBlock(bodyWithoutMarker, block);
  assert.match(appended, /기존 본문/);
  assert.match(appended, /<!-- pr-ai-summary:start -->/);

  const bodyWithMarker = [
    '앞부분',
    '<!-- pr-ai-summary:start -->',
    'old',
    '<!-- pr-ai-summary:end -->',
    '뒷부분',
  ].join('\n');

  const replaced = upsertSummaryBlock(bodyWithMarker, block);
  assert.match(replaced, /앞부분/);
  assert.match(replaced, /뒷부분/);
  assert.equal((replaced.match(/<!-- pr-ai-summary:start -->/g) ?? []).length, 1);
  assert.equal((replaced.match(/<!-- pr-ai-summary:end -->/g) ?? []).length, 1);
  assert.doesNotMatch(replaced, /\nold\n/);
});

test('CodeRabbit summary가 이미 있으면 그 앞에 PR AI 블록을 끼워 넣는다', () => {
  const summary = {
    title: 'docs: PR 요약 포맷 조정',
    summary: '요약',
    summaryBullets: [],
    changes: [{ file: '.github/scripts/pr-ai-description-lib.mjs', description: '삽입 순서 조정' }],
    impact: [],
    checklist: [],
    breakingChanges: [],
    relatedIssues: [],
    dependencies: [],
    labels: [],
  };

  const block = renderSummaryBlock(summary);
  const body = [
    '기존 본문',
    '',
    '## Summary by CodeRabbit',
    '기존 CodeRabbit summary',
  ].join('\n');

  const updated = upsertSummaryBlock(body, block);

  assert.match(updated, /기존 본문/);
  assert.match(updated, /<!-- pr-ai-summary:start -->/);
  assert.match(updated, /## Summary by CodeRabbit/);
  assert.ok(updated.indexOf('<!-- pr-ai-summary:end -->') < updated.indexOf('## Summary by CodeRabbit'));
});

test('Compare API fallback 조건에서 patch 누락 1개만 있어도 fallback 된다', () => {
  const files = [
    { filename: 'src/a.ts', status: 'modified', patch: '@@ -1 +1 @@' },
    { filename: 'src/b.ts', status: 'modified' },
  ];

  const decision = decideCompareFallback({
    files,
    excludeGlobs: buildExcludeGlobs(''),
    maxFiles: 10,
  });

  assert.equal(decision.useFallback, true);
  assert.equal(decision.reason, 'compare-missing-patch');
});

test('Compare API 성공 조건이면 fallback 없이 진행한다', () => {
  const files = [
    { filename: 'src/a.ts', status: 'modified', patch: '@@ -1 +1 @@' },
    { filename: 'src/b.ts', status: 'added', patch: '@@ -0,0 +1 @@' },
  ];

  const decision = decideCompareFallback({
    files,
    excludeGlobs: buildExcludeGlobs(''),
    maxFiles: 10,
  });

  assert.equal(decision.useFallback, false);
  assert.equal(decision.included.length, 2);
});

test('레포 라벨 목록 기준으로 unknown 라벨을 제거한다', () => {
  const aiLabels = ['Bug', 'invalid', 'db', 'BUG', ''];
  const repoLabels = ['bug', 'feature', 'db'];

  const result = filterKnownLabels(aiLabels, repoLabels);

  assert.deepEqual(result.applicableLabels, ['bug', 'db']);
  assert.equal(result.unknownLabelsIgnoredCount, 2);
});
