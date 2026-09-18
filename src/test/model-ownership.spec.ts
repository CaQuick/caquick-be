import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { FEATURE_SERVICE, MODEL_OWNERSHIP } from '@/test/model-ownership';
import {
  collectWriteSites,
  isAllowedWriter,
  loadSchema,
  relPath,
  type WriteSite,
} from '@/test/model-ownership.helper';

// 모델별 단일 writer(D1 서비스 경계)를 코드로 강제한다. 판정은 write 호출이 놓인 feature 파일 기준(P1-2).
// 아래 예외 목록은 P1 시작 시점 실측(92 사이트)이며, 항목이 옮겨질 때마다 줄을 지운다 — 늘어나면 실패한다.

const schema = loadSchema();

/** [파일, 모델, 사이트 수] — 소유 feature 밖에서 write하는 현재 코드. P1 종료 시 빈 표가 목표. */
const WRITE_EXCEPTIONS: Array<[file: string, model: string, sites: number]> = [
  ['src/features/admin/repositories/admin.repository.ts', 'Account', 3],
  [
    'src/features/admin/repositories/admin.repository.ts',
    'AccountCredential',
    3,
  ],
  [
    'src/features/admin/repositories/admin.repository.ts',
    'AuthRefreshSession',
    2,
  ],
  ['src/features/admin/repositories/admin.repository.ts', 'Banner', 3],
  ['src/features/admin/repositories/admin.repository.ts', 'Category', 4],
  ['src/features/admin/repositories/admin.repository.ts', 'Notification', 1],
  ['src/features/admin/repositories/admin.repository.ts', 'Product', 1],
  ['src/features/admin/repositories/admin.repository.ts', 'ProductCategory', 1],
  ['src/features/admin/repositories/admin.repository.ts', 'ProductTag', 1],
  ['src/features/admin/repositories/admin.repository.ts', 'Region', 4],
  ['src/features/admin/repositories/admin.repository.ts', 'Review', 1],
  ['src/features/admin/repositories/admin.repository.ts', 'ReviewComment', 2],
  ['src/features/admin/repositories/admin.repository.ts', 'ReviewMedia', 1],
  ['src/features/admin/repositories/admin.repository.ts', 'ReviewReport', 3],
  ['src/features/admin/repositories/admin.repository.ts', 'SellerProfile', 1],
  ['src/features/admin/repositories/admin.repository.ts', 'Store', 3],
  ['src/features/admin/repositories/admin.repository.ts', 'Tag', 4],
  ['src/features/order/repositories/order.repository.ts', 'AuditLog', 2],
  ['src/features/order/repositories/order.repository.ts', 'Notification', 2],
  ['src/features/seller/repositories/seller.repository.ts', 'Store', 1],
  [
    'src/features/seller/repositories/seller.repository.ts',
    'StoreBusinessHour',
    1,
  ],
  [
    'src/features/seller/repositories/seller.repository.ts',
    'StoreDailyCapacity',
    3,
  ],
  ['src/features/seller/repositories/seller.repository.ts', 'StoreFaqTopic', 3],
  [
    'src/features/seller/repositories/seller.repository.ts',
    'StoreSpecialClosure',
    3,
  ],
  [
    'src/features/store/repositories/store-wishlist.repository.ts',
    'StoreWishlistItem',
    3,
  ],
  [
    'src/features/user/repositories/recent-product-view.repository.ts',
    'RecentProductView',
    4,
  ],
  [
    'src/features/user/repositories/review-report.repository.ts',
    'ReviewReport',
    1,
  ],
  ['src/features/user/repositories/review.repository.ts', 'Review', 3],
  ['src/features/user/repositories/review.repository.ts', 'ReviewComment', 1],
  ['src/features/user/repositories/review.repository.ts', 'ReviewMedia', 3],
  ['src/features/user/repositories/review.repository.ts', 'ReviewReport', 1],
  ['src/features/user/repositories/user.repository.ts', 'Account', 3],
  ['src/features/user/repositories/user.repository.ts', 'AccountIdentity', 1],
  [
    'src/features/user/repositories/user.repository.ts',
    'AuthRefreshSession',
    1,
  ],
  ['src/features/user/repositories/user.repository.ts', 'Notification', 3],
  ['src/features/user/repositories/user.repository.ts', 'ReviewComment', 2],
  ['src/features/user/repositories/user.repository.ts', 'ReviewLike', 3],
  ['src/features/user/repositories/user.repository.ts', 'ReviewReport', 1],
  ['src/features/user/repositories/user.repository.ts', 'SearchHistory', 2],
  ['src/features/user/repositories/user.repository.ts', 'UserProfile', 4],
  ['src/features/user/repositories/user.repository.ts', 'WishlistItem', 3],
];

function groupViolations(
  sites: WriteSite[],
  base?: string,
): Array<[string, string, number]> {
  const counts = new Map<string, number>();
  for (const site of sites) {
    if (isAllowedWriter(site)) continue;
    const file = base ? relative(base, site.file) : relPath(site.file);
    const key = `${file}|${site.model}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, n]) => {
      const [file, model] = key.split('|');
      return [file, model, n];
    });
}

describe('모델 소유권 (단일 writer)', () => {
  it('소유 맵은 스키마 모델 전수와 1:1이다', () => {
    expect(Object.keys(MODEL_OWNERSHIP).sort()).toEqual(
      [...schema.models].sort(),
    );
  });

  it('feature→서비스 매핑의 feature는 실제 디렉터리에 존재한다', () => {
    const features = new Set(
      collectWriteSites(schema)
        .map((s) => s.feature)
        .concat(Object.keys(FEATURE_SERVICE)),
    );
    for (const feature of Object.keys(FEATURE_SERVICE))
      expect(features.has(feature)).toBe(true);
  });

  it('소유 feature 밖 write는 예외 목록과 정확히 일치한다', () => {
    const found = groupViolations(collectWriteSites(schema));
    expect(found).toEqual(WRITE_EXCEPTIONS);
    expect(found.reduce((sum, [, , n]) => sum + n, 0)).toBe(92);
  });

  describe('검사기 반증', () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'ownership-'));
      mkdirSync(join(dir, 'product'), { recursive: true });
      mkdirSync(join(dir, 'review'), { recursive: true });
      // 허용 밖 feature의 직접 write + relation 아래 nested create + 상수로 넘긴 data
      writeFileSync(
        join(dir, 'product', 'bad.repository.ts'),
        [
          'const payload = { rating: 5, media: { createMany: { data: [] } } } as const;',
          'export function f(tx: any, prisma: any) {',
          '  tx.review.create({ data: payload });',
          '  prisma.order.update({ where: { id: 1n }, data: { status_histories: { create: {} } } });',
          '  this.prisma.product.update({ where: { id: 1n }, data: {} });',
          '}',
        ].join('\n'),
      );
      writeFileSync(
        join(dir, 'review', 'ok.repository.ts'),
        'export function g(tx: any) { tx.review.create({ data: { media: { create: [] } } }); }',
      );
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('허용 밖 feature의 직접·nested write를 모두 잡고, 소유 feature의 write는 통과시킨다', () => {
      const found = groupViolations(collectWriteSites(schema, dir), dir);
      expect(found).toEqual([
        ['product/bad.repository.ts', 'Order', 1],
        ['product/bad.repository.ts', 'OrderStatusHistory', 1],
        ['product/bad.repository.ts', 'Review', 1],
        ['product/bad.repository.ts', 'ReviewMedia', 1],
      ]);
      const ok = collectWriteSites(schema, dir).filter(
        (s) => s.feature === 'review',
      );
      expect(ok.map((s) => s.model).sort()).toEqual(['Review', 'ReviewMedia']);
      expect(ok.every(isAllowedWriter)).toBe(true);
    });
  });
});
