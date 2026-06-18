import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { RegionRepository } from '@/features/region/repositories/region.repository';
import { RegionQueryResolver } from '@/features/region/resolvers/region-query.resolver';
import { RegionService } from '@/features/region/services/region.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createRegion } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/**
 * Resolver ↔ Service ↔ Repository ↔ DB 통합 경로 검증.
 * 분기별 세부 검증은 service.spec.ts에서 담당.
 */
describe('Region Query Resolver (real DB)', () => {
  let resolver: RegionQueryResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [RegionQueryResolver, RegionService, RegionRepository],
    });
    resolver = module.get(RegionQueryResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('regionGroups: 1차 목록을 반환한다', async () => {
    await createRegion(prisma, {
      level: 1,
      name: '전국',
      slug: 'nationwide',
      sort_order: 0,
    });

    const result = await resolver.regionGroups();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('전국');
  });

  it('regions: parentId의 2차 목록을 반환한다', async () => {
    const parent = await createRegion(prisma, { level: 1, slug: 'p' });
    await createRegion(prisma, {
      level: 2,
      name: '강남구',
      slug: 'gn',
      parent_id: parent.id,
    });

    const result = await resolver.regions(parent.id.toString());

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('강남구');
  });

  it('regions: 존재하지 않는 parentId면 NotFoundException 전파', async () => {
    await expect(resolver.regions('999999')).rejects.toThrow(NotFoundException);
  });

  it('searchRegions: 키워드로 검색 결과를 반환한다', async () => {
    await createRegion(prisma, { level: 1, name: '인천', slug: 'incheon' });

    const result = await resolver.searchRegions({ keyword: '인천' });

    expect(result[0].name).toBe('인천');
  });
});
