import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminStoreService } from '@/features/admin/services/admin-store.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createAccountCredential,
  createOrderItem,
  createProduct,
  createRegion,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AdminStoreService (real DB)', () => {
  let service: AdminStoreService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminStoreService,
        AdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    service = module.get(AdminStoreService);
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

  async function district() {
    const group = await createRegion(prisma, { level: 1 });
    return createRegion(prisma, { level: 2, parent_id: group.id });
  }

  describe('adminStores', () => {
    it('전체 매장을 최신순으로 반환하고 keyword·isActive·regionId 필터가 totalCount에도 적용된다', async () => {
      const region = await district();
      const a = await createStore(prisma, {
        store_name: '바늘 케이크',
        region_id: region.id,
      });
      await createStore(prisma, { store_name: '실 케이크', is_active: false });

      const all = await service.adminStores(await admin());
      expect(all.totalCount).toBe(2);

      const byKeyword = await service.adminStores(await admin(), {
        keyword: '바늘',
      });
      expect(byKeyword.items.map((s) => s.id)).toEqual([a.id.toString()]);

      const active = await service.adminStores(await admin(), {
        isActive: true,
      });
      expect(active.totalCount).toBe(1);

      const byRegion = await service.adminStores(await admin(), {
        regionId: region.id.toString(),
      });
      expect(byRegion.totalCount).toBe(1);
      expect(byRegion.items[0].regionId).toBe(region.id.toString());
    });

    it('limit+1 조회로 hasMore·nextCursor를 판정하고 삭제 매장은 제외한다', async () => {
      const ids = [
        (await createStore(prisma)).id,
        (await createStore(prisma)).id,
        (await createStore(prisma)).id,
      ];
      await createStore(prisma, { deleted_at: new Date() });

      const page1 = await service.adminStores(await admin(), { limit: 2 });
      expect(page1.totalCount).toBe(3);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBe(ids[1].toString());

      const page2 = await service.adminStores(await admin(), {
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items.map((s) => s.id)).toEqual([ids[0].toString()]);
    });
  });

  describe('adminStore', () => {
    it('소유 판매자 요약과 상품·주문 항목 집계(삭제 제외)를 함께 준다', async () => {
      const credential = await createAccountCredential(prisma, {
        account_type: 'SELLER',
        username: 'owner.one',
      });
      const store = await createStore(prisma, {
        seller_account_id: credential.account_id,
      });
      const product = await createProduct(prisma, { store_id: store.id });
      const deleted = await createProduct(prisma, { store_id: store.id });
      await prisma.product.update({
        where: { id: deleted.id },
        data: { deleted_at: new Date() },
      });
      // 주문 항목 팩토리는 상품을 새로 만들지 않도록 기존 상품을 지정한다
      await createOrderItem(prisma, {
        store_id: store.id,
        product_id: product.id,
      });

      const result = await service.adminStore(await admin(), store.id);

      expect(result.store.id).toBe(store.id.toString());
      expect(result.seller.accountId).toBe(credential.account_id.toString());
      expect(result.seller.username).toBe('owner.one');
      expect(result.productCount).toBe(1);
      expect(result.orderItemCount).toBe(1);
    });

    it('없거나 삭제된 매장이면 NotFoundException', async () => {
      const deleted = await createStore(prisma, { deleted_at: new Date() });
      await expect(
        service.adminStore(await admin(), deleted.id),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.adminStore(await admin(), BigInt(999_999)),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('adminSetStoreActive', () => {
    it('노출을 끄고 audit(STORE/STATUS_CHANGE, reason)을 남긴다', async () => {
      const actor = await admin();
      const store = await createStore(prisma);

      const result = await service.adminSetStoreActive(actor, {
        storeId: store.id.toString(),
        isActive: false,
        reason: '위생 점검',
      });

      expect(result.isActive).toBe(false);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { target_type: 'STORE', target_id: store.id },
      });
      expect(audit).toMatchObject({
        actor_account_id: actor,
        store_id: store.id,
        action: 'STATUS_CHANGE',
        before_json: { isActive: true },
        after_json: { isActive: false, reason: '위생 점검' },
      });
    });

    it('같은 값이면 그대로 반환하고 audit을 남기지 않는다(멱등)', async () => {
      const store = await createStore(prisma, { is_active: true });

      const result = await service.adminSetStoreActive(await admin(), {
        storeId: store.id.toString(),
        isActive: true,
      });

      expect(result.isActive).toBe(true);
      expect(await prisma.auditLog.count()).toBe(0);
    });

    it('없는 매장이면 NotFoundException', async () => {
      await expect(
        service.adminSetStoreActive(await admin(), {
          storeId: '999999',
          isActive: false,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('adminUpdateStoreBasicInfo', () => {
    it('전달한 필드만 바꾸고 audit before/after에 바뀐 컬럼만 남긴다', async () => {
      const actor = await admin();
      const store = await createStore(prisma, { store_name: '옛 이름' });

      const result = await service.adminUpdateStoreBasicInfo(actor, {
        storeId: store.id.toString(),
        storeName: '새 이름',
        latitude: '37.5',
        websiteUrl: null,
      });

      expect(result.storeName).toBe('새 이름');
      expect(result.latitude).toBe('37.5');
      expect(result.websiteUrl).toBeNull();
      expect(result.storePhone).toBe(store.store_phone);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { target_type: 'STORE', target_id: store.id, action: 'UPDATE' },
      });
      expect(audit.before_json).toEqual({
        store_name: '옛 이름',
        latitude: null,
        website_url: null,
      });
      expect(audit.after_json).toEqual({
        store_name: '새 이름',
        latitude: '37.5',
        website_url: null,
      });
    });

    it('regionId: 활성 2차 지역은 연결하고 null은 해제한다', async () => {
      const region = await district();
      const store = await createStore(prisma);

      const linked = await service.adminUpdateStoreBasicInfo(await admin(), {
        storeId: store.id.toString(),
        regionId: region.id.toString(),
      });
      expect(linked.regionId).toBe(region.id.toString());

      const cleared = await service.adminUpdateStoreBasicInfo(await admin(), {
        storeId: store.id.toString(),
        regionId: null,
      });
      expect(cleared.regionId).toBeNull();
    });

    it('regionId 빈 문자열은 해제가 아니라 BadRequestException(기존 연결 유지)', async () => {
      const region = await district();
      const store = await createStore(prisma, { region_id: region.id });
      await expect(
        service.adminUpdateStoreBasicInfo(await admin(), {
          storeId: store.id.toString(),
          regionId: '',
        }),
      ).rejects.toThrow(BadRequestException);
      const row = await prisma.store.findUniqueOrThrow({
        where: { id: store.id },
      });
      expect(row.region_id).toBe(region.id);
    });

    it.each([
      ['1차 지역', async () => (await createRegion(prisma, { level: 1 })).id],
      [
        '비활성 2차 지역',
        async () =>
          (await createRegion(prisma, { level: 2, is_active: false })).id,
      ],
      ['없는 지역', () => Promise.resolve(BigInt(999_999))],
    ])('%s을 regionId로 주면 BadRequestException', async (_label, makeId) => {
      const store = await createStore(prisma);
      await expect(
        service.adminUpdateStoreBasicInfo(await admin(), {
          storeId: store.id.toString(),
          regionId: (await makeId()).toString(),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('판매자와 같은 규칙: 필수 공백·좌표 형식·길이 초과는 BadRequestException', async () => {
      const store = await createStore(prisma);
      const base = { storeId: store.id.toString() };
      await expect(
        service.adminUpdateStoreBasicInfo(await admin(), {
          ...base,
          storeName: '   ',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.adminUpdateStoreBasicInfo(await admin(), {
          ...base,
          longitude: 'east',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.adminUpdateStoreBasicInfo(await admin(), {
          ...base,
          storePhone: '0'.repeat(31),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('감사 기록이 실패하면 수정도 롤백된다(같은 트랜잭션)', async () => {
      const store = await createStore(prisma, { store_name: '원본' });
      const auditLogs = service['auditLogs'];
      const spy = jest
        .spyOn(auditLogs, 'createAuditLog')
        .mockRejectedValueOnce(new Error('audit down'));

      await expect(
        service.adminUpdateStoreBasicInfo(await admin(), {
          storeId: store.id.toString(),
          storeName: '바뀜',
        }),
      ).rejects.toThrow('audit down');
      const row = await prisma.store.findUniqueOrThrow({
        where: { id: store.id },
      });
      expect(row.store_name).toBe('원본');
      spy.mockRestore();
    });
  });
});
