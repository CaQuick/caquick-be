import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 리뷰 도메인에서 행 잠금을 잡는 모든 경로의 전수 표(D7-c).
 *
 * 불변식은 **부모 리뷰를 가장 먼저 잠근다**이다. 모든 경로가 리뷰 행부터 잠그면, 경쟁 트랜잭션은
 * 리뷰 잠금을 먼저 얻어야 하므로 댓글·신고 행을 사이에 두고 서로를 기다리는 교착이 생기지 않는다.
 * (리뷰를 잡은 뒤의 댓글·신고 순서는 경로마다 달라도 안전하다 — 실제로 softDeleteReview는 신고를
 * 먼저 닫고 댓글을 내린다. 표에 그대로 적어 두고, 바뀌면 이 spec이 실패한다.)
 */

const REVIEW_DIR = join(__dirname, '..');

type LockResource = 'review' | 'review_comment' | 'review_report';

/** 소스에서 행 잠금을 잡는 표현. 표현이 늘면 여기에 추가해야 전수 검사가 성립한다. */
const LOCK_MARKERS: { pattern: RegExp; resource: LockResource }[] = [
  { pattern: /lockParentReviewOfComment\(/g, resource: 'review' },
  { pattern: /this\.lockReportableTarget\(/g, resource: 'review' },
  { pattern: /FOR UPDATE OF r\b/g, resource: 'review' },
  { pattern: /FOR SHARE OF r\b/g, resource: 'review' },
  { pattern: /lockActiveReviewRow\(\s*tx,\s*'review'/g, resource: 'review' },
  { pattern: /tx\.review\.update\(/g, resource: 'review' },
  { pattern: /tx\.review\.updateMany\(/g, resource: 'review' },
  {
    pattern: /this\.lockReportableComment\(/g,
    resource: 'review_comment',
  },
  {
    pattern: /lockActiveReviewRow\(\s*tx,\s*'review_comment'/g,
    resource: 'review_comment',
  },
  {
    pattern: /lockActiveReviewRow\(\s*tx,\s*target\.kind/g,
    resource: 'review_comment',
  },
  {
    pattern: /FROM review_comment c\b[\s\S]{0,400}?FOR UPDATE\b/g,
    resource: 'review_comment',
  },
  {
    pattern: /tx\.reviewComment\.(?:update|updateMany|create)\(/g,
    resource: 'review_comment',
  },
  {
    pattern: /lockActiveReviewRow\(\s*tx,\s*'review_report'/g,
    resource: 'review_report',
  },
  { pattern: /resolvePendingReports\(/g, resource: 'review_report' },
  {
    pattern: /tx\.reviewReport\.(?:update|updateMany|create)\(/g,
    resource: 'review_report',
  },
];

/** 잠금을 잡는 경로와 그 순서(정본). 새 경로가 생기면 줄을 추가해야 전수 검사가 통과한다. */
const LOCK_SITES: {
  file: string;
  method: string;
  sequence: LockResource[];
}[] = [
  {
    file: 'review-report.repository.ts',
    method: 'submitReport',
    sequence: ['review', 'review_report'],
  },
  {
    file: 'review-report.repository.ts',
    method: 'lockReportableTarget',
    sequence: ['review', 'review_comment'],
  },
  {
    file: 'review-report.repository.ts',
    method: 'lockReportableComment',
    sequence: ['review', 'review_comment'],
  },
  {
    file: 'review-admin.repository.ts',
    method: 'resolveReviewReport',
    sequence: [
      'review',
      'review_comment',
      'review_report',
      'review_report',
      'review_report',
    ],
  },
  {
    file: 'review-admin.repository.ts',
    method: 'adminSoftDeleteReview',
    sequence: ['review', 'review_report'],
  },
  {
    file: 'review-admin.repository.ts',
    method: 'adminSoftDeleteReviewComment',
    sequence: ['review', 'review_comment', 'review_report'],
  },
  {
    file: 'review-admin.repository.ts',
    method: 'softDeleteTargetTx',
    sequence: ['review', 'review_comment', 'review_comment'],
  },
  {
    file: 'review-engagement.repository.ts',
    method: 'createReviewComment',
    sequence: ['review', 'review_comment'],
  },
  {
    file: 'review-engagement.repository.ts',
    method: 'softDeleteMyReviewComment',
    sequence: ['review', 'review_comment', 'review_report'],
  },
  {
    // 재작성(복원)은 예전에 신고를 먼저 닫아 리뷰보다 앞섰다 — 순서를 뒤집어 리뷰부터 잠근다(D7-c)
    file: 'review.repository.ts',
    method: 'createOrRestoreReviewWithMedia',
    sequence: ['review', 'review_report'],
  },
  {
    // 리뷰를 먼저 잠근 뒤라 신고 → 댓글 순서라도 안전하다(위 불변식 참고)
    file: 'review.repository.ts',
    method: 'softDeleteReview',
    sequence: ['review', 'review_report', 'review_comment'],
  },
];

function lockSequence(body: string): LockResource[] {
  const hits: { index: number; resource: LockResource }[] = [];
  for (const { pattern, resource } of LOCK_MARKERS) {
    for (const match of body.matchAll(pattern)) {
      hits.push({ index: match.index, resource });
    }
  }
  return hits.sort((a, b) => a.index - b.index).map((hit) => hit.resource);
}

/** 파일을 메서드 단위로 쪼갠다(선언 → 다음 선언 직전). */
function methodBodies(source: string): Map<string, string> {
  const declarations = [
    ...source.matchAll(/\n {2}(?:private )?async (\w+)\s*\(/g),
  ].map((match) => ({ index: match.index, name: match[1] }));
  const bodies = new Map<string, string>();
  for (const [i, declaration] of declarations.entries()) {
    const end = declarations[i + 1]?.index ?? source.length;
    bodies.set(declaration.name, source.slice(declaration.index, end));
  }
  return bodies;
}

function sourceFiles(): string[] {
  return readdirSync(join(REVIEW_DIR, 'repositories'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
    .sort();
}

describe('리뷰 도메인 잠금 순서 (전수)', () => {
  const sourceOf = (file: string): string =>
    readFileSync(join(REVIEW_DIR, 'repositories', file), 'utf8');

  it.each(LOCK_SITES.map((site) => [`${site.file} › ${site.method}`, site]))(
    '%s의 잠금 순서가 표와 같고 리뷰를 가장 먼저 잠근다',
    (_label, site) => {
      const body = methodBodies(sourceOf(site.file)).get(site.method);
      expect(body).toBeDefined();

      const sequence = lockSequence(body!);

      expect(sequence).toEqual(site.sequence);
      // 불변식: 어떤 경로든 부모 리뷰부터 잠근다
      expect(sequence[0]).toBe('review');
    },
  );

  it('표 밖에서 잠금을 잡는 경로가 없다(전수)', () => {
    const listed = new Map<string, Set<string>>();
    for (const site of LOCK_SITES) {
      const methods = listed.get(site.file) ?? new Set<string>();
      methods.add(site.method);
      listed.set(site.file, methods);
    }

    const unlisted: string[] = [];
    for (const file of sourceFiles()) {
      for (const [method, body] of methodBodies(sourceOf(file))) {
        if (lockSequence(body).length === 0) continue;
        if (listed.get(file)?.has(method)) continue;
        unlisted.push(`${file} › ${method}`);
      }
    }

    expect(unlisted).toEqual([]);
  });

  it('반증: 신고를 리뷰보다 먼저 잠그는 경로(복원 경로의 옛 순서)는 불변식에 걸린다', () => {
    const inverted = [
      '  async restore(tx) {',
      '    await resolvePendingReports(tx, { where: {} });',
      '    await tx.review.update({ where: { id } });',
      '  }',
    ].join('\n');

    const sequence = lockSequence(inverted);

    expect(sequence).toEqual(['review_report', 'review']);
    expect(sequence[0]).not.toBe('review');
  });
});
