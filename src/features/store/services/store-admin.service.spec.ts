import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { StoreAdminRepository } from '@/features/store/repositories/store-admin.repository';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import { AdminStoreService } from '@/features/store/services/store-admin.service';
import type { PrismaClient } from '@/generated/prisma/client';
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
import {
  FOREIGN_UPLOAD_URL,
  ownedUploadUrl,
  s3TestProviders,
} from '@/test/storage/s3-test.helper';

describe('AdminStoreService (real DB)', () => {
  let service: AdminStoreService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        StoreSellerRepository,
        ...s3TestProviders(),
        AdminStoreService,
        StoreAdminRepository,
        AccountAdminRepository,
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

      // "0"은 유효한 ID라 조건이 빠지지 않고 빈 결과여야 한다
      const zero = await service.adminStores(await admin(), { regionId: '0' });
      expect(zero.totalCount).toBe(0);
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

    it('없거나 삭제된 매장이면 404', async () => {
      const deleted = await createStore(prisma, { deleted_at: new Date() });
      await expect(
        service.adminStore(await admin(), deleted.id),
      ).rejects.toThrowDomain(404);
      await expect(
        service.adminStore(await admin(), BigInt(999_999)),
      ).rejects.toThrowDomain(404);
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

    it('없는 매장이면 404', async () => {
      await expect(
        service.adminSetStoreActive(await admin(), {
          storeId: '999999',
          isActive: false,
        }),
      ).rejects.toThrowDomain(404);
    });

    it('두 관리자가 동시에 같은 값으로 토글해도 감사는 1건(잠금 뒤 트랜잭션 안에서 판정)', async () => {
      const store = await createStore(prisma, { is_active: true });
      const [a, b] = [await admin(), await admin()];
      await Promise.all([
        service.adminSetStoreActive(a, {
          storeId: store.id.toString(),
          isActive: false,
        }),
        service.adminSetStoreActive(b, {
          storeId: store.id.toString(),
          isActive: false,
        }),
      ]);
      expect(
        await prisma.auditLog.count({
          where: { target_type: 'STORE', target_id: store.id },
        }),
      ).toBe(1);
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

    it('regionId 빈 문자열은 해제가 아니라 400(기존 연결 유지)', async () => {
      const region = await district();
      const store = await createStore(prisma, { region_id: region.id });
      await expect(
        service.adminUpdateStoreBasicInfo(await admin(), {
          storeId: store.id.toString(),
          regionId: '',
        }),
      ).rejects.toThrowDomain(400);
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
    ])('%s을 regionId로 주면 400', async (_label, makeId) => {
      const store = await createStore(prisma);
      await expect(
        service.adminUpdateStoreBasicInfo(await admin(), {
          storeId: store.id.toString(),
          regionId: (await makeId()).toString(),
        }),
      ).rejects.toThrowDomain(400);
    });

    it('판매자와 같은 규칙: 필수 공백·좌표 형식·길이 초과는 400', async () => {
      const store = await createStore(prisma);
      const base = { storeId: store.id.toString() };
      await expect(
        service.adminUpdateStoreBasicInfo(await admin(), {
          ...base,
          storeName: '   ',
        }),
      ).rejects.toThrowDomain(400);
      await expect(
        service.adminUpdateStoreBasicInfo(await admin(), {
          ...base,
          longitude: 'east',
        }),
      ).rejects.toThrowDomain(400);
      await expect(
        service.adminUpdateStoreBasicInfo(await admin(), {
          ...base,
          storePhone: '0'.repeat(31),
        }),
      ).rejects.toThrowDomain(400);
    });

    it('동시 수정의 감사 before는 트랜잭션 안에서 읽은 실제 직전 값이다', async () => {
      const store = await createStore(prisma, { store_name: 'A' });
      const [a, b] = [await admin(), await admin()];
      await Promise.all([
        service.adminUpdateStoreBasicInfo(a, {
          storeId: store.id.toString(),
          storeName: 'B',
        }),
        service.adminUpdateStoreBasicInfo(b, {
          storeId: store.id.toString(),
          storeName: 'C',
        }),
      ]);
      const audits = await prisma.auditLog.findMany({
        where: { target_type: 'STORE', target_id: store.id, action: 'UPDATE' },
        orderBy: { id: 'asc' },
      });
      expect(audits).toHaveLength(2);
      const [first, second] = audits.map(
        (x) => x.before_json as { store_name: string },
      );
      // 두 번째 감사의 before는 첫 번째 감사의 after와 같아야 한다(A→B→C 또는 A→C→B)
      const firstAfter = audits[0].after_json as { store_name: string };
      expect(first.store_name).toBe('A');
      expect(second.store_name).toBe(firstAfter.store_name);
    });

    it('삭제된 매장은 잠금 단계에서 404(되살리지 않음)', async () => {
      const store = await createStore(prisma, { deleted_at: new Date() });
      await expect(
        service.adminUpdateStoreBasicInfo(await admin(), {
          storeId: store.id.toString(),
          storeName: 'x',
        }),
      ).rejects.toThrowDomain(404);
    });

    it('감사 기록이 실패하면 수정도 롤백된다(같은 트랜잭션)', async () => {
      const store = await createStore(prisma, { store_name: '원본' });
      const auditLogs = service['auditLogs'];
      const spy = jest
        .spyOn(auditLogs, 'recordAudit')
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

  describe('이미지 URL 소유권', () => {
    const rejected = [
      [
        '타 계정 prefix',
        (id: bigint) => ownedUploadUrl('STORE_IMAGE', id + BigInt(1)),
      ],
      [
        '타 용도(BANNER_IMAGE) prefix',
        (id: bigint) => ownedUploadUrl('BANNER_IMAGE', id),
      ],
      ['외부 호스트', () => FOREIGN_UPLOAD_URL],
    ] as const;

    it.each(rejected)(
      'adminUpdateStoreBasicInfo.profileImageUrl이 %s면 BadRequest',
      async (_label, url) => {
        const actor = await admin();
        const store = await createStore(prisma);
        await expect(
          service.adminUpdateStoreBasicInfo(actor, {
            storeId: store.id.toString(),
            profileImageUrl: url(actor),
          }),
        ).rejects.toThrowDomain('INVALID_IMAGE_URL');
      },
    );

    it('발급된 URL이면 저장하고 null이면 제거한다', async () => {
      const actor = await admin();
      const store = await createStore(prisma);
      const url = ownedUploadUrl('STORE_IMAGE', actor, 'logo.png');

      const saved = await service.adminUpdateStoreBasicInfo(actor, {
        storeId: store.id.toString(),
        profileImageUrl: url,
      });
      expect(saved.profileImageUrl).toBe(url);

      const removed = await service.adminUpdateStoreBasicInfo(actor, {
        storeId: store.id.toString(),
        profileImageUrl: null,
      });
      expect(removed.profileImageUrl).toBeNull();
    });
  });
});
