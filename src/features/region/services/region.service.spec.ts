import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { RegionRepository } from '@/features/region/repositories/region.repository';
import { RegionService } from '@/features/region/services/region.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createRegion } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/**
 * Service ↔ Repository ↔ DB 통합 검증. region feature는 인증이 없는 public 조회라
 * 분기/매핑 검증을 service spec에 집중한다.
 */
describe('RegionService (real DB)', () => {
  let service: RegionService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [RegionService, RegionRepository],
    });
    service = module.get(RegionService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('regionGroups', () => {
    it('1차 지역만 sort_order 순으로 반환하고 hasChildren를 채운다', async () => {
      const seoulNorth = await createRegion(prisma, {
        level: 1,
        name: '서울 북부',
        slug: 'seoul-north',
        sort_order: 1,
      });
      await createRegion(prisma, {
        level: 1,
        name: '전국',
        slug: 'nationwide',
        sort_order: 0,
      });
      await createRegion(prisma, {
        level: 2,
        name: '강남구',
        slug: 'sgg-11680',
        parent_id: seoulNorth.id,
      });

      const result = await service.regionGroups();

      // sort_order 오름차순: 전국(0) → 서울 북부(1)
      expect(result.map((r) => r.slug)).toEqual(['nationwide', 'seoul-north']);
      expect(result.find((r) => r.slug === 'seoul-north')?.hasChildren).toBe(
        true,
      );
      expect(result.find((r) => r.slug === 'nationwide')?.hasChildren).toBe(
        false,
      );
    });

    it('비활성/soft-delete 1차는 제외한다', async () => {
      await createRegion(prisma, { level: 1, slug: 'active-g' });
      await createRegion(prisma, {
        level: 1,
        slug: 'inactive-g',
        is_active: false,
      });
      const deleted = await createRegion(prisma, {
        level: 1,
        slug: 'deleted-g',
      });
      await prisma.region.update({
        where: { id: deleted.id },
        data: { deleted_at: new Date() },
      });

      const result = await service.regionGroups();

      expect(result.map((r) => r.slug)).toEqual(['active-g']);
    });

    it('soft-delete된 2차는 hasChildren 판정에서 제외된다', async () => {
      const group = await createRegion(prisma, { level: 1, slug: 'g-only' });
      const child = await createRegion(prisma, {
        level: 2,
        slug: 'c-deleted',
        parent_id: group.id,
      });
      await prisma.region.update({
        where: { id: child.id },
        data: { deleted_at: new Date() },
      });

      const result = await service.regionGroups();

      expect(result.find((r) => r.slug === 'g-only')?.hasChildren).toBe(false);
    });
  });

  describe('regions', () => {
    it('특정 1차의 활성 2차만 sort_order 순으로 반환한다', async () => {
      const parent = await createRegion(prisma, { level: 1, slug: 'p1' });
      const other = await createRegion(prisma, { level: 1, slug: 'p2' });
      await createRegion(prisma, {
        level: 2,
        name: 'B구',
        slug: 'b',
        parent_id: parent.id,
        sort_order: 1,
      });
      await createRegion(prisma, {
        level: 2,
        name: 'A구',
        slug: 'a',
        parent_id: parent.id,
        sort_order: 0,
      });
      await createRegion(prisma, {
        level: 2,
        slug: 'other-child',
        parent_id: other.id,
      });
      await createRegion(prisma, {
        level: 2,
        slug: 'inactive-child',
        parent_id: parent.id,
        is_active: false,
      });

      const result = await service.regions(parent.id.toString());

      expect(result.map((r) => r.slug)).toEqual(['a', 'b']);
      expect(result[0]).toMatchObject({
        name: 'A구',
        level: 2,
        parentId: parent.id.toString(),
      });
    });

    it('존재하지 않는 1차면 NotFoundException', async () => {
      await expect(service.regions('999999')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('2차 id를 parentId로 주면 NotFoundException (level 1만 허용)', async () => {
      const parent = await createRegion(prisma, { level: 1, slug: 'pp' });
      const child = await createRegion(prisma, {
        level: 2,
        slug: 'cc',
        parent_id: parent.id,
      });

      await expect(service.regions(child.id.toString())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('유효하지 않은 parentId 문자열이면 BadRequestException', async () => {
      await expect(service.regions('not-a-number')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('searchRegions', () => {
    it('이름 부분일치로 2차를 찾고 parentName을 동반한다', async () => {
      const incheon = await createRegion(prisma, {
        level: 1,
        name: '인천',
        slug: 'incheon',
      });
      await createRegion(prisma, {
        level: 2,
        name: '중구',
        slug: 'sgg-28110',
        parent_id: incheon.id,
      });

      const result = await service.searchRegions({ keyword: '중' });

      const jung = result.find((r) => r.name === '중구');
      expect(jung?.level).toBe(2);
      expect(jung?.parentName).toBe('인천');
    });

    it('1차 결과는 parentName이 null', async () => {
      await createRegion(prisma, {
        level: 1,
        name: '서울 북부',
        slug: 'seoul-north',
      });

      const result = await service.searchRegions({ keyword: '서울' });

      const seoul = result.find((r) => r.name === '서울 북부');
      expect(seoul?.level).toBe(1);
      expect(seoul?.parentName).toBeNull();
    });

    it('빈/공백 검색어는 DB 조회 없이 빈 배열', async () => {
      await createRegion(prisma, { level: 1, name: '서울', slug: 's' });

      expect(await service.searchRegions({ keyword: '   ' })).toEqual([]);
    });

    it('limit으로 결과 개수를 제한한다', async () => {
      const parent = await createRegion(prisma, {
        level: 1,
        name: '테스트시',
        slug: 't',
      });
      for (let i = 0; i < 5; i++) {
        await createRegion(prisma, {
          level: 2,
          name: `테스트동${i}`,
          slug: `t${i}`,
          parent_id: parent.id,
          sort_order: i,
        });
      }

      const result = await service.searchRegions({
        keyword: '테스트',
        limit: 3,
      });

      expect(result).toHaveLength(3);
    });

    it('비활성 지역은 검색되지 않는다', async () => {
      await createRegion(prisma, {
        level: 1,
        name: '숨김지역',
        slug: 'hidden',
        is_active: false,
      });

      expect(await service.searchRegions({ keyword: '숨김' })).toEqual([]);
    });
  });
});
