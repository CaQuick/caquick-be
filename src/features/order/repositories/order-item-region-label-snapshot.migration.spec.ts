import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildRegionLabel } from '@/common/utils/region-label';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createOrderItem, createRegion, createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 백필 SQL을 그대로 실행해, 주문 생성 경로(buildRegionLabel)와 같은 표기가 채워지는지 본다.
// 마이그레이션은 빈 DB에 적용되므로 여기서만 검증된다.
const MIGRATION = join(
  __dirname,
  '../../../../prisma/migrations/20261102144339_order_item_region_label_snapshot/migration.sql',
);

function backfillStatements(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const body = sql.slice(
    sql.indexOf('-- backfill'),
    sql.indexOf('-- end backfill'),
  );
  return body
    .split(';')
    .map((stmt) => stmt.replace(/^\s*--[^\n]*$/gm, '').trim())
    .filter((stmt) => stmt.length > 0);
}

interface StoreAddress {
  city: string | null;
  dong: string | null;
  region?: { name: string; deleted?: boolean };
}

describe('order_item 지역 표기 스냅샷 백필 (real DB)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    ({ prisma } = await createTestingModuleWithRealDb({ providers: [] }));
  });
  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  it.each<[string, StoreAddress, string | null]>([
    [
      '시+동',
      { city: '인천', dong: '청라동', region: { name: '서구' } },
      '인천 청라동',
    ],
    ['시만', { city: '인천', dong: null }, '인천'],
    ['동만', { city: null, dong: '청라동' }, '청라동'],
    [
      '주소 없이 지역만',
      { city: null, dong: null, region: { name: '서구' } },
      '서구',
    ],
    [
      '빈 문자열 시·동은 건너뛰고 지역명',
      { city: '', dong: '', region: { name: '서구' } },
      '서구',
    ],
    // NULLIF(x, '')였다면 PAD SPACE 비교로 비워져 JS 규칙과 어긋난다
    [
      '공백만 있는 시도 JS 규칙처럼 쓴다',
      { city: ' ', dong: '청라동' },
      '  청라동',
    ],
    [
      'soft-delete된 지역도 조회 경로처럼 쓴다',
      { city: null, dong: null, region: { name: '서구', deleted: true } },
      '서구',
    ],
    ['주소·지역 모두 없으면 null', { city: null, dong: null }, null],
  ])('%s', async (_case, address, expected) => {
    const region = address.region
      ? await createRegion(prisma, { name: address.region.name, level: 2 })
      : null;
    if (address.region?.deleted) {
      await prisma.region.update({
        where: { id: region!.id },
        data: { deleted_at: new Date() },
      });
    }
    const store = await createStore(prisma, { region_id: region?.id ?? null });
    await prisma.store.update({
      where: { id: store.id },
      data: { address_city: address.city, address_neighborhood: address.dong },
    });
    // 백필 대상 재현: 스냅샷이 비어 있는(=마이그레이션 전) 품목
    const item = await createOrderItem(prisma, {
      store_id: store.id,
      store_region_label_snapshot: null,
    });

    const statements = backfillStatements();
    expect(statements).toHaveLength(1);
    await prisma.$executeRawUnsafe(statements[0]);

    const row = await prisma.orderItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    const current = await prisma.store.findUniqueOrThrow({
      where: { id: store.id },
      include: { region: { select: { name: true } } },
    });
    expect(row.store_region_label_snapshot).toBe(expected);
    expect(row.store_region_label_snapshot).toBe(buildRegionLabel(current));
  });
});
