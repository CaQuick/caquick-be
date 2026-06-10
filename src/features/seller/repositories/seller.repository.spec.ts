import { AccountType, type PrismaClient } from '@prisma/client';

import {
  isSellerAccount,
  nextCursorOf,
  normalizeCursorInput,
  SellerRepository,
} from '@/features/seller/repositories/seller.repository';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createProduct,
  createStore,
  setupSellerWithStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SellerRepository (real DB)', () => {
  let repo: SellerRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [SellerRepository],
    });
    repo = module.get(SellerRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─── account / store context ──
  describe('findSellerAccountContext', () => {
    it('계정 + store id 를 함께 반환한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const result = await repo.findSellerAccountContext(account.id);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(account.id);
      expect(result!.account_type).toBe('SELLER');
      expect(result!.store?.id).toBe(store.id);
    });

    it('store 가 없는 SELLER 계정도 조회된다 (store 는 null)', async () => {
      const account = await createAccount(prisma, { account_type: 'SELLER' });
      const result = await repo.findSellerAccountContext(account.id);
      expect(result!.store).toBeNull();
    });

    it('존재하지 않으면 null', async () => {
      const result = await repo.findSellerAccountContext(BigInt(999999));
      expect(result).toBeNull();
    });
  });

  describe('findStoreBySellerAccountId / findStoreOwnership', () => {
    it('findStoreBySellerAccountId: 본인 매장을 반환한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const result = await repo.findStoreBySellerAccountId(account.id);
      expect(result?.id).toBe(store.id);
    });

    it('findStoreBySellerAccountId: 매장이 없으면 null', async () => {
      const result = await repo.findStoreBySellerAccountId(BigInt(999999));
      expect(result).toBeNull();
    });

    it('findStoreOwnership: storeId 로 id 만 반환한다', async () => {
      const { store } = await setupSellerWithStore(prisma);
      const result = await repo.findStoreOwnership(store.id);
      expect(result?.id).toBe(store.id);
    });

    it('findStoreOwnership: 존재하지 않으면 null', async () => {
      const result = await repo.findStoreOwnership(BigInt(999999));
      expect(result).toBeNull();
    });
  });

  describe('updateStore', () => {
    it('매장 정보를 갱신한다', async () => {
      const { store } = await setupSellerWithStore(prisma);
      const updated = await repo.updateStore({
        storeId: store.id,
        data: { store_name: '새 이름' },
      });
      expect(updated.store_name).toBe('새 이름');
    });
  });

  // ─── business hours ──
  describe('listStoreBusinessHours / upsertStoreBusinessHour', () => {
    it('day_of_week 오름차순 정렬', async () => {
      const { store } = await setupSellerWithStore(prisma);
      await prisma.storeBusinessHour.createMany({
        data: [
          { store_id: store.id, day_of_week: 2, is_closed: false },
          { store_id: store.id, day_of_week: 0, is_closed: true },
        ],
      });

      const rows = await repo.listStoreBusinessHours(store.id);
      expect(rows.map((r) => r.day_of_week)).toEqual([0, 2]);
    });

    it('upsert: 없으면 생성, 있으면 갱신 (같은 store+day 1 row 유지)', async () => {
      const { store } = await setupSellerWithStore(prisma);
      const created = await repo.upsertStoreBusinessHour({
        storeId: store.id,
        dayOfWeek: 1,
        isClosed: false,
        openTime: new Date('1970-01-01T09:00:00Z'),
        closeTime: new Date('1970-01-01T18:00:00Z'),
      });
      const updated = await repo.upsertStoreBusinessHour({
        storeId: store.id,
        dayOfWeek: 1,
        isClosed: true,
        openTime: null,
        closeTime: null,
      });
      expect(updated.id).toBe(created.id);
      expect(updated.is_closed).toBe(true);
      expect(updated.open_time).toBeNull();

      const rows = await prisma.storeBusinessHour.findMany({
        where: { store_id: store.id, day_of_week: 1 },
      });
      expect(rows).toHaveLength(1);
    });
  });

  // ─── special closure ──
  describe('storeSpecialClosure (create/update/findById/softDelete/list)', () => {
    it('create: 새 row 생성', async () => {
      const { store } = await setupSellerWithStore(prisma);
      const row = await repo.createStoreSpecialClosure({
        storeId: store.id,
        closureDate: new Date('2026-05-01'),
        reason: '정기 휴무',
      });
      expect(row.store_id).toBe(store.id);
      expect(row.reason).toBe('정기 휴무');
    });

    it('create: 동일 store+date 가 soft-delete 상태였다면 복구(deleted_at=null)된다', async () => {
      const { store } = await setupSellerWithStore(prisma);
      const seed = await prisma.storeSpecialClosure.create({
        data: {
          store_id: store.id,
          closure_date: new Date('2026-05-01'),
          reason: '구',
          deleted_at: new Date(),
        },
      });

      const row = await repo.createStoreSpecialClosure({
        storeId: store.id,
        closureDate: new Date('2026-05-01'),
        reason: '신',
      });
      expect(row.id).toBe(seed.id);
      expect(row.deleted_at).toBeNull();
      expect(row.reason).toBe('신');
    });

    it('updateStoreSpecialClosure: closureDate / reason 갱신', async () => {
      const { store } = await setupSellerWithStore(prisma);
      const seed = await prisma.storeSpecialClosure.create({
        data: { store_id: store.id, closure_date: new Date('2026-05-01') },
      });
      const updated = await repo.updateStoreSpecialClosure(seed.id, {
        closureDate: new Date('2026-05-02'),
        reason: '수정',
      });
      expect(updated.reason).toBe('수정');
    });

    it('findStoreSpecialClosureById: 본인 매장만 반환', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      const othersClosure = await prisma.storeSpecialClosure.create({
        data: {
          store_id: other.store.id,
          closure_date: new Date('2026-05-01'),
        },
      });

      const ok = await repo.findStoreSpecialClosureById(
        othersClosure.id,
        me.store.id,
      );
      expect(ok).toBeNull();
    });

    it('softDeleteStoreSpecialClosure 후 deleted_at 채워짐', async () => {
      const { store } = await setupSellerWithStore(prisma);
      const seed = await prisma.storeSpecialClosure.create({
        data: { store_id: store.id, closure_date: new Date('2026-05-01') },
      });
      await repo.softDeleteStoreSpecialClosure(seed.id);
      const after = await prisma.storeSpecialClosure.findUnique({
        where: { id: seed.id },
      });
      expect(after?.deleted_at).not.toBeNull();
    });

    it('listStoreSpecialClosures: cursor / limit 동작', async () => {
      const { store } = await setupSellerWithStore(prisma);
      for (let i = 1; i <= 3; i++) {
        await prisma.storeSpecialClosure.create({
          data: {
            store_id: store.id,
            closure_date: new Date(`2026-05-0${i}`),
          },
        });
      }
      const all = await repo.listStoreSpecialClosures({
        storeId: store.id,
        limit: 100,
      });
      expect(all).toHaveLength(3);

      const limited = await repo.listStoreSpecialClosures({
        storeId: store.id,
        limit: 1,
      });
      expect(limited).toHaveLength(2); // limit + 1

      // cursor (id 내림차순이므로 cursor 보다 작은 id 만)
      const paged = await repo.listStoreSpecialClosures({
        storeId: store.id,
        limit: 100,
        cursor: limited[0].id,
      });
      expect(paged.every((r) => r.id < limited[0].id)).toBe(true);
    });
  });

  // ─── daily capacity ──
  describe('storeDailyCapacity (create/update/findById/softDelete/list)', () => {
    it('create: 새 row 생성', async () => {
      const { store } = await setupSellerWithStore(prisma);
      const row = await repo.createStoreDailyCapacity({
        storeId: store.id,
        capacityDate: new Date('2026-06-01'),
        capacity: 100,
      });
      expect(row.capacity).toBe(100);
    });

    it('create: soft-delete row 가 있으면 복구', async () => {
      const { store } = await setupSellerWithStore(prisma);
      const seed = await prisma.storeDailyCapacity.create({
        data: {
          store_id: store.id,
          capacity_date: new Date('2026-06-01'),
          capacity: 50,
          deleted_at: new Date(),
        },
      });
      const row = await repo.createStoreDailyCapacity({
        storeId: store.id,
        capacityDate: new Date('2026-06-01'),
        capacity: 100,
      });
      expect(row.id).toBe(seed.id);
      expect(row.deleted_at).toBeNull();
      expect(row.capacity).toBe(100);
    });

    it('updateStoreDailyCapacity: 날짜·캐파 갱신', async () => {
      const { store } = await setupSellerWithStore(prisma);
      const seed = await prisma.storeDailyCapacity.create({
        data: {
          store_id: store.id,
          capacity_date: new Date('2026-06-01'),
          capacity: 50,
        },
      });
      const updated = await repo.updateStoreDailyCapacity(seed.id, {
        capacityDate: new Date('2026-06-02'),
        capacity: 200,
      });
      expect(updated.capacity).toBe(200);
    });

    it('findStoreDailyCapacityById: 본인 매장만', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      const otherCap = await prisma.storeDailyCapacity.create({
        data: {
          store_id: other.store.id,
          capacity_date: new Date('2026-06-01'),
          capacity: 1,
        },
      });
      const result = await repo.findStoreDailyCapacityById(
        otherCap.id,
        me.store.id,
      );
      expect(result).toBeNull();
    });

    it('softDelete 후 deleted_at 채워짐', async () => {
      const { store } = await setupSellerWithStore(prisma);
      const seed = await prisma.storeDailyCapacity.create({
        data: {
          store_id: store.id,
          capacity_date: new Date('2026-06-01'),
          capacity: 50,
        },
      });
      await repo.softDeleteStoreDailyCapacity(seed.id);
      const after = await prisma.storeDailyCapacity.findUnique({
        where: { id: seed.id },
      });
      expect(after?.deleted_at).not.toBeNull();
    });

    it('list: fromDate / toDate 필터 + cursor', async () => {
      const { store } = await setupSellerWithStore(prisma);
      await prisma.storeDailyCapacity.createMany({
        data: [
          {
            store_id: store.id,
            capacity_date: new Date('2026-05-30'),
            capacity: 10,
          },
          {
            store_id: store.id,
            capacity_date: new Date('2026-06-15'),
            capacity: 20,
          },
          {
            store_id: store.id,
            capacity_date: new Date('2026-07-05'),
            capacity: 30,
          },
        ],
      });

      const inRange = await repo.listStoreDailyCapacities({
        storeId: store.id,
        limit: 100,
        fromDate: new Date('2026-06-01'),
        toDate: new Date('2026-06-30'),
      });
      expect(inRange).toHaveLength(1);
      expect(inRange[0].capacity).toBe(20);

      const fromOnly = await repo.listStoreDailyCapacities({
        storeId: store.id,
        limit: 100,
        fromDate: new Date('2026-07-01'),
      });
      expect(fromOnly).toHaveLength(1);

      const toOnly = await repo.listStoreDailyCapacities({
        storeId: store.id,
        limit: 100,
        toDate: new Date('2026-06-01'),
      });
      expect(toOnly).toHaveLength(1);

      const noFilter = await repo.listStoreDailyCapacities({
        storeId: store.id,
        limit: 100,
      });
      expect(noFilter).toHaveLength(3);

      // cursor
      const first = await repo.listStoreDailyCapacities({
        storeId: store.id,
        limit: 1,
      });
      expect(first).toHaveLength(2); // limit + 1
      const paged = await repo.listStoreDailyCapacities({
        storeId: store.id,
        limit: 100,
        cursor: first[0].id,
      });
      expect(paged.every((r) => r.id < first[0].id)).toBe(true);
    });
  });

  // ─── faq topic ──
  describe('faqTopic (list/create/findById/update/softDelete)', () => {
    it('list: sort_order, id 오름차순', async () => {
      const { store } = await setupSellerWithStore(prisma);
      await prisma.storeFaqTopic.createMany({
        data: [
          {
            store_id: store.id,
            title: 'C',
            answer_html: '',
            sort_order: 2,
          },
          {
            store_id: store.id,
            title: 'A',
            answer_html: '',
            sort_order: 0,
          },
          {
            store_id: store.id,
            title: 'B',
            answer_html: '',
            sort_order: 1,
          },
        ],
      });
      const rows = await repo.listFaqTopics(store.id);
      expect(rows.map((r) => r.title)).toEqual(['A', 'B', 'C']);
    });

    it('create: 신규 FAQ topic 생성', async () => {
      const { store } = await setupSellerWithStore(prisma);
      const row = await repo.createFaqTopic({
        storeId: store.id,
        title: 'Q',
        answerHtml: '<p>A</p>',
        sortOrder: 0,
        isActive: true,
      });
      expect(row.title).toBe('Q');
      expect(row.answer_html).toBe('<p>A</p>');
    });

    it('findFaqTopicById: 본인 매장만', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      const othersFaq = await prisma.storeFaqTopic.create({
        data: { store_id: other.store.id, title: 'x', answer_html: 'x' },
      });
      const r = await repo.findFaqTopicById({
        topicId: othersFaq.id,
        storeId: me.store.id,
      });
      expect(r).toBeNull();
    });

    it('updateFaqTopic + softDeleteFaqTopic', async () => {
      const { store } = await setupSellerWithStore(prisma);
      const seed = await prisma.storeFaqTopic.create({
        data: { store_id: store.id, title: 'old', answer_html: 'a' },
      });

      const updated = await repo.updateFaqTopic({
        topicId: seed.id,
        data: { title: 'new' },
      });
      expect(updated.title).toBe('new');

      await repo.softDeleteFaqTopic(seed.id);
      const after = await prisma.storeFaqTopic.findUnique({
        where: { id: seed.id },
      });
      expect(after?.deleted_at).not.toBeNull();
    });
  });

  // ─── banner ──
  describe('banner (list/findById/create/update/softDelete)', () => {
    async function createBannerFor(storeId: bigint, overrides = {}) {
      return prisma.banner.create({
        data: {
          placement: 'STORE',
          image_url: 'https://i.example/a.png',
          link_type: 'STORE',
          link_store_id: storeId,
          ...overrides,
        },
      });
    }

    it('list: link_store_id 또는 link_product.store_id 기준 본인 store 만', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);

      // 본인 store_id 직접 link
      await createBannerFor(me.store.id);

      // 본인 product 를 link 한 banner
      const myProduct = await createProduct(prisma, { store_id: me.store.id });
      await prisma.banner.create({
        data: {
          placement: 'HOME_MAIN',
          image_url: 'https://i.example/p.png',
          link_type: 'PRODUCT',
          link_product_id: myProduct.id,
        },
      });

      // 다른 매장 (제외 대상)
      await createBannerFor(other.store.id);

      const rows = await repo.listBannersByStore({
        storeId: me.store.id,
        limit: 100,
      });
      expect(rows).toHaveLength(2);
    });

    it('list: cursor / limit', async () => {
      const { store } = await setupSellerWithStore(prisma);
      for (let i = 0; i < 3; i++) {
        await createBannerFor(store.id);
      }
      const first = await repo.listBannersByStore({
        storeId: store.id,
        limit: 1,
      });
      expect(first).toHaveLength(2); // limit + 1

      const paged = await repo.listBannersByStore({
        storeId: store.id,
        limit: 100,
        cursor: first[0].id,
      });
      expect(paged.every((r) => r.id < first[0].id)).toBe(true);
    });

    it('findBannerByIdForStore: 본인 매장만', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      const othersBanner = await createBannerFor(other.store.id);
      const r = await repo.findBannerByIdForStore({
        bannerId: othersBanner.id,
        storeId: me.store.id,
      });
      expect(r).toBeNull();
    });

    it('create + update + softDelete', async () => {
      const { store } = await setupSellerWithStore(prisma);
      const created = await repo.createBanner({
        placement: 'STORE',
        title: 't',
        imageUrl: 'https://i.example/a.png',
        linkType: 'STORE',
        linkUrl: null,
        linkProductId: null,
        linkStoreId: store.id,
        linkCategoryId: null,
        startsAt: null,
        endsAt: null,
        sortOrder: 0,
        isActive: true,
      });
      expect(created.title).toBe('t');

      const updated = await repo.updateBanner({
        bannerId: created.id,
        data: { title: 'updated' },
      });
      expect(updated.title).toBe('updated');

      await repo.softDeleteBanner(created.id);
      const after = await prisma.banner.findUnique({
        where: { id: created.id },
      });
      expect(after?.deleted_at).not.toBeNull();
    });
  });

  // ─── audit log ──
  describe('listAuditLogsBySeller', () => {
    async function createLog(
      args: Partial<{
        actorAccountId: bigint;
        storeId: bigint | null;
        targetType: 'STORE' | 'PRODUCT' | 'ORDER';
        targetId: bigint;
      }> = {},
    ) {
      const me = await setupSellerWithStore(prisma);
      return prisma.auditLog.create({
        data: {
          actor_account_id: args.actorAccountId ?? me.account.id,
          store_id: args.storeId === undefined ? me.store.id : args.storeId,
          target_type: args.targetType ?? 'STORE',
          target_id: args.targetId ?? me.store.id,
          action: 'UPDATE',
        },
      });
    }

    it('actor=본인 또는 storeId=본인 인 row 반환 (OR)', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);

      // 본인 actor
      const mineByActor = await prisma.auditLog.create({
        data: {
          actor_account_id: me.account.id,
          store_id: null,
          target_type: 'STORE',
          target_id: me.store.id,
          action: 'UPDATE',
        },
      });
      // 본인 store
      const mineByStore = await prisma.auditLog.create({
        data: {
          actor_account_id: other.account.id,
          store_id: me.store.id,
          target_type: 'STORE',
          target_id: me.store.id,
          action: 'UPDATE',
        },
      });
      // 다른 매장 (제외)
      await prisma.auditLog.create({
        data: {
          actor_account_id: other.account.id,
          store_id: other.store.id,
          target_type: 'STORE',
          target_id: other.store.id,
          action: 'UPDATE',
        },
      });

      const rows = await repo.listAuditLogsBySeller({
        sellerAccountId: me.account.id,
        storeId: me.store.id,
        limit: 100,
      });
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(mineByActor.id);
      expect(ids).toContain(mineByStore.id);
      expect(rows).toHaveLength(2);
    });

    it('targetType 필터', async () => {
      await createLog({ targetType: 'STORE' });
      const orderLog = await createLog({ targetType: 'ORDER' });
      const filtered = await repo.listAuditLogsBySeller({
        sellerAccountId: orderLog.actor_account_id,
        storeId: orderLog.store_id!,
        limit: 100,
        targetType: 'ORDER',
      });
      expect(filtered.every((r) => r.target_type === 'ORDER')).toBe(true);
    });

    it('cursor / limit', async () => {
      const me = await setupSellerWithStore(prisma);
      for (let i = 0; i < 3; i++) {
        await prisma.auditLog.create({
          data: {
            actor_account_id: me.account.id,
            store_id: me.store.id,
            target_type: 'STORE',
            target_id: me.store.id,
            action: 'UPDATE',
          },
        });
      }
      const first = await repo.listAuditLogsBySeller({
        sellerAccountId: me.account.id,
        storeId: me.store.id,
        limit: 1,
      });
      expect(first).toHaveLength(2);

      const paged = await repo.listAuditLogsBySeller({
        sellerAccountId: me.account.id,
        storeId: me.store.id,
        limit: 100,
        cursor: first[0].id,
      });
      expect(paged.every((r) => r.id < first[0].id)).toBe(true);
    });
  });

  // ─── standalone export functions ──
  describe('normalizeCursorInput', () => {
    it('미설정이면 기본 limit 20, cursor undefined', () => {
      const r = normalizeCursorInput();
      expect(r.limit).toBe(20);
      expect(r.cursor).toBeUndefined();
    });

    it('limit 은 1~100 clamp', () => {
      expect(normalizeCursorInput({ limit: 0 }).limit).toBe(1);
      expect(normalizeCursorInput({ limit: 1000 }).limit).toBe(100);
      expect(normalizeCursorInput({ limit: 50 }).limit).toBe(50);
    });

    it('cursor 값 그대로 전달, null 이면 미포함', () => {
      const r = normalizeCursorInput({ cursor: 42n });
      expect(r.cursor).toBe(42n);
      expect(normalizeCursorInput({ cursor: null }).cursor).toBeUndefined();
    });

    it('limit null 이면 기본 20', () => {
      expect(normalizeCursorInput({ limit: null }).limit).toBe(20);
    });
  });

  describe('nextCursorOf', () => {
    it('rows.length <= limit 이면 nextCursor null + items 그대로', () => {
      const rows = [{ id: 1n }, { id: 2n }];
      const r = nextCursorOf(rows, 5);
      expect(r.items).toEqual(rows);
      expect(r.nextCursor).toBeNull();
    });

    it('rows.length > limit 이면 limit 만큼 자르고 마지막 id 를 nextCursor 로', () => {
      const rows = [{ id: 10n }, { id: 9n }, { id: 8n }];
      const r = nextCursorOf(rows, 2);
      expect(r.items).toEqual([{ id: 10n }, { id: 9n }]);
      expect(r.nextCursor).toBe('9');
    });
  });

  describe('isSellerAccount', () => {
    it('SELLER 이면 true, 그 외는 false', () => {
      expect(isSellerAccount(AccountType.SELLER)).toBe(true);
      expect(isSellerAccount(AccountType.USER)).toBe(false);
      expect(isSellerAccount(AccountType.ADMIN)).toBe(false);
    });
  });

  // createStore factory 미사용 import 워닝 방지용 — 이미 위에서 setupSellerWithStore 가 store 를 만들지만,
  // createStore 단독 사용 경로도 한 번 커버해두면 다른 spec 의존성 변화에도 안정적임.
  it('createStore factory 단독 호출도 정상 동작 (factory smoke)', async () => {
    const store = await createStore(prisma);
    expect(store.id).toBeDefined();
  });
});
