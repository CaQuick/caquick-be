import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminRegionService } from '@/features/admin/services/admin-region.service';
import { AdminStoreService } from '@/features/admin/services/admin-store.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createRegion, createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { s3TestProviders } from '@/test/storage/s3-test.helper';

describe('AdminRegionService (real DB)', () => {
  let service: AdminRegionService;
  let storeService: AdminStoreService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ...s3TestProviders(),
        AdminRegionService,
        AdminStoreService,
        AdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    service = module.get(AdminRegionService);
    storeService = module.get(AdminStoreService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function admin(): Promise<bigint> {
    return (await createAccount(prisma, { account_type: 'ADMIN' })).id;
  }

  describe('adminRegions', () => {
    it('level·sortOrder 순, 기본은 활성만, parentId 필터, 집계(매장·활성 하위)', async () => {
      const seoul = await createRegion(prisma, {
        level: 1,
        name: '서울',
        sort_order: 1,
      });
      const gangnam = await createRegion(prisma, {
        level: 2,
        parent_id: seoul.id,
        sort_order: 2,
      });
      const mapo = await createRegion(prisma, {
        level: 2,
        parent_id: seoul.id,
        sort_order: 1,
      });
      await createRegion(prisma, {
        level: 2,
        parent_id: seoul.id,
        is_active: false,
      });
      await createStore(prisma, { region_id: gangnam.id });

      const all = await service.adminRegions(await admin());
      expect(all.map((r) => r.id)).toEqual(
        [seoul.id, mapo.id, gangnam.id].map(String),
      );
      expect(all[0].childCount).toBe(2);
      expect(all[2].storeCount).toBe(1);

      const children = await service.adminRegions(await admin(), {
        parentId: seoul.id.toString(),
        includeInactive: true,
      });
      expect(children).toHaveLength(3);
    });
  });

  describe('adminCreateRegion', () => {
    it('parentId 없으면 1차, 있으면 2차로 만들고 좌표·감사를 남긴다', async () => {
      const actor = await admin();
      const group = await service.adminCreateRegion(actor, {
        name: ' 경기 ',
        slug: 'gyeonggi',
        centerLat: '37.4',
        centerLng: '127.1',
      });
      expect(group).toMatchObject({
        level: 1,
        parentId: null,
        name: '경기',
        centerLat: '37.4',
      });

      const child = await service.adminCreateRegion(actor, {
        parentId: group.id,
        name: '수원시',
        slug: 'suwon',
        sortOrder: 3,
      });
      expect(child).toMatchObject({
        level: 2,
        parentId: group.id,
        sortOrder: 3,
      });
      expect(
        await prisma.auditLog.count({
          where: { target_type: 'REGION', action: 'CREATE' },
        }),
      ).toBe(2);
    });

    it.each([
      ['2차 지역', async () => (await createRegion(prisma, { level: 2 })).id],
      [
        '비활성 1차 지역',
        async () =>
          (await createRegion(prisma, { level: 1, is_active: false })).id,
      ],
      ['없는 지역', () => Promise.resolve(BigInt(999_999))],
    ])('parentId가 %s이면 BadRequestException', async (_label, makeId) => {
      await expect(
        service.adminCreateRegion(await admin(), {
          parentId: (await makeId()).toString(),
          name: 'x',
          slug: 'x-region',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('slug 충돌은 BadRequestException, 삭제된 slug는 복구한다', async () => {
      const old = await createRegion(prisma, { level: 1, slug: 'busan' });
      await expect(
        service.adminCreateRegion(await admin(), { name: 'x', slug: 'busan' }),
      ).rejects.toThrow(BadRequestException);

      await service.adminDeleteRegion(await admin(), old.id);
      const restored = await service.adminCreateRegion(await admin(), {
        name: '부산',
        slug: 'busan',
      });
      expect(restored.id).toBe(old.id.toString());
      expect(restored.name).toBe('부산');
    });

    it('좌표가 범위 밖이면 BadRequestException', async () => {
      await expect(
        service.adminCreateRegion(await admin(), {
          name: 'x',
          slug: 'x-1',
          centerLat: '95',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('adminUpdateRegion', () => {
    it('전달한 필드만 바꾸고 좌표 null은 제거, 감사 before/after', async () => {
      const region = await createRegion(prisma, { level: 1, name: '옛' });
      await prisma.region.update({
        where: { id: region.id },
        data: { center_lat: 1, center_lng: 2 },
      });

      const result = await service.adminUpdateRegion(await admin(), {
        regionId: region.id.toString(),
        name: '새',
        centerLat: null,
      });

      expect(result.name).toBe('새');
      expect(result.centerLat).toBeNull();
      expect(result.centerLng).toBe('2');
      expect(result.slug).toBe(region.slug);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: {
          target_type: 'REGION',
          target_id: region.id,
          action: 'UPDATE',
        },
      });
      expect(audit.before_json).toMatchObject({ name: '옛' });
      expect(audit.after_json).toMatchObject({ name: '새' });
    });

    it('좌표만 바꿔도 감사 before/after에 좌표가 남는다', async () => {
      const region = await createRegion(prisma, { level: 1 });
      await service.adminUpdateRegion(await admin(), {
        regionId: region.id.toString(),
        centerLat: '37.5',
      });
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: {
          target_type: 'REGION',
          target_id: region.id,
          action: 'UPDATE',
        },
      });
      expect(audit.before_json).toMatchObject({
        centerLat: null,
        centerLng: null,
      });
      expect(audit.after_json).toMatchObject({
        centerLat: '37.5',
        centerLng: null,
      });
    });

    // 계층 불변식: 1차 비활성 → 활성 하위 없어야, 2차 활성 → 상위가 활성이어야(고아 활성 지역 방지)
    it('활성 하위가 있는 1차 비활성화·상위가 비활성인 2차 활성화는 BadRequestException', async () => {
      const group = await createRegion(prisma, { level: 1 });
      const child = await createRegion(prisma, {
        level: 2,
        parent_id: group.id,
        is_active: false,
      });
      const active = await createRegion(prisma, {
        level: 2,
        parent_id: group.id,
      });

      await expect(
        service.adminUpdateRegion(await admin(), {
          regionId: group.id.toString(),
          isActive: false,
        }),
      ).rejects.toThrow(BadRequestException);

      await service.adminUpdateRegion(await admin(), {
        regionId: active.id.toString(),
        isActive: false,
      });
      await service.adminUpdateRegion(await admin(), {
        regionId: group.id.toString(),
        isActive: false,
      });
      await expect(
        service.adminUpdateRegion(await admin(), {
          regionId: child.id.toString(),
          isActive: true,
        }),
      ).rejects.toThrow(BadRequestException);
      // 이미 활성인 2차의 다른 필드 수정은 상위와 무관
      await service.adminUpdateRegion(await admin(), {
        regionId: group.id.toString(),
        isActive: true,
      });
      expect(
        (
          await service.adminUpdateRegion(await admin(), {
            regionId: child.id.toString(),
            isActive: true,
          })
        ).isActive,
      ).toBe(true);
    });

    it('삭제된 지역의 slug로 바꾸면 BadRequestException(전역 unique 인덱스)', async () => {
      const gone = await createRegion(prisma, { slug: 'gone' });
      await prisma.region.update({
        where: { id: gone.id },
        data: { deleted_at: new Date() },
      });
      const mine = await createRegion(prisma, { slug: 'mine' });
      await expect(
        service.adminUpdateRegion(await admin(), {
          regionId: mine.id.toString(),
          slug: 'gone',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('slug 충돌은 BadRequestException, 없으면 NotFoundException', async () => {
      await createRegion(prisma, { slug: 'taken' });
      const mine = await createRegion(prisma, { slug: 'mine' });
      await expect(
        service.adminUpdateRegion(await admin(), {
          regionId: mine.id.toString(),
          slug: 'taken',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.adminUpdateRegion(await admin(), {
          regionId: '999999',
          name: 'x',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('adminCreateRegion 상위 확인', () => {
    it('비활성·삭제된 1차를 상위로 주면 BadRequestException', async () => {
      const inactive = await createRegion(prisma, {
        level: 1,
        is_active: false,
      });
      await expect(
        service.adminCreateRegion(await admin(), {
          parentId: inactive.id.toString(),
          name: '하위',
          slug: 'child-of-inactive',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('adminDeleteRegion', () => {
    // 지역 잠금(FOR UPDATE)과 매장 연결의 지역 잠금(FOR SHARE)이 직렬화돼야 삭제된 지역에 매장이 매달리지 않는다
    it('지역 삭제와 매장 연결이 겹쳐도 삭제된 지역에 매장이 남지 않는다', async () => {
      const group = await createRegion(prisma, { level: 1 });
      const child = await createRegion(prisma, {
        level: 2,
        parent_id: group.id,
      });
      const store = await createStore(prisma);

      const [deleted, linked] = await Promise.allSettled([
        service.adminDeleteRegion(await admin(), child.id),
        storeService.adminUpdateStoreBasicInfo(await admin(), {
          storeId: store.id.toString(),
          regionId: child.id.toString(),
        }),
      ]);

      const region = await prisma.region.findFirstOrThrow({
        where: { id: child.id, deleted_at: undefined },
      });
      const row = await prisma.store.findUniqueOrThrow({
        where: { id: store.id },
      });
      if (deleted.status === 'fulfilled') {
        expect(region.deleted_at).not.toBeNull();
        expect(linked.status).toBe('rejected');
        expect(row.region_id).toBeNull();
      } else {
        expect(deleted.reason).toBeInstanceOf(BadRequestException);
        expect(region.deleted_at).toBeNull();
        expect(row.region_id).toBe(child.id);
      }
    });

    it('연결 매장이 있는 2차·활성 하위가 있는 1차는 BadRequestException, 없으면 soft-delete + 감사', async () => {
      const group = await createRegion(prisma, { level: 1 });
      const child = await createRegion(prisma, {
        level: 2,
        parent_id: group.id,
      });
      await createStore(prisma, { region_id: child.id });

      await expect(
        service.adminDeleteRegion(await admin(), child.id),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.adminDeleteRegion(await admin(), group.id),
      ).rejects.toThrow(BadRequestException);

      await prisma.store.updateMany({
        where: { region_id: child.id },
        data: { region_id: null },
      });
      expect(await service.adminDeleteRegion(await admin(), child.id)).toBe(
        true,
      );
      expect(await service.adminDeleteRegion(await admin(), group.id)).toBe(
        true,
      );
      expect(
        await prisma.auditLog.count({
          where: { target_type: 'REGION', action: 'DELETE' },
        }),
      ).toBe(2);
      await expect(
        service.adminDeleteRegion(await admin(), group.id),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
