import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import {
  isSellerAccount,
  StoreSellerRepository,
} from '@/features/store/repositories/store-seller.repository';
import { AuditActionType, AuditTargetType } from '@/generated/prisma/client';
import { AccountType, type PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createStore,
  createStoreDailyCapacity,
  setupSellerWithStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/** repository가 조작과 같은 트랜잭션에 남기는 감사 항목 — 내용 자체는 서비스 spec이 본다. */
const AUDIT_ENTRY = {
  actorAccountId: 1n,
  storeId: null,
  targetType: AuditTargetType.STORE,
  targetId: 1n,
  action: AuditActionType.UPDATE,
};

describe('StoreSellerRepository (real DB)', () => {
  let repo: StoreSellerRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        StoreSellerRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    repo = module.get(StoreSellerRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

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
      const updated = await repo.updateStore(
        {
          storeId: store.id,
          data: { store_name: '새 이름' },
        },
        () => AUDIT_ENTRY,
      );
      expect(updated.store_name).toBe('새 이름');
    });
  });

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
      const created = await repo.upsertStoreBusinessHour(
        {
          storeId: store.id,
          dayOfWeek: 1,
          isClosed: false,
          openTime: new Date('1970-01-01T09:00:00Z'),
          closeTime: new Date('1970-01-01T18:00:00Z'),
        },
        () => AUDIT_ENTRY,
      );
      const updated = await repo.upsertStoreBusinessHour(
        {
          storeId: store.id,
          dayOfWeek: 1,
          isClosed: true,
          openTime: null,
          closeTime: null,
        },
        () => AUDIT_ENTRY,
      );
      expect(updated.id).toBe(created.id);
      expect(updated.is_closed).toBe(true);
      expect(updated.open_time).toBeNull();

      const rows = await prisma.storeBusinessHour.findMany({
        where: { store_id: store.id, day_of_week: 1 },
      });
      expect(rows).toHaveLength(1);
    });
  });

  describe('storeSpecialClosure (create/update/findById/softDelete/list)', () => {
    it('create: 새 row 생성', async () => {
      const { store } = await setupSellerWithStore(prisma);
      const row = await repo.createStoreSpecialClosure(
        {
          storeId: store.id,
          closureDate: new Date('2026-05-01'),
          reason: '정기 휴무',
        },
        () => AUDIT_ENTRY,
      );
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

      const row = await repo.createStoreSpecialClosure(
        {
          storeId: store.id,
          closureDate: new Date('2026-05-01'),
          reason: '신',
        },
        () => AUDIT_ENTRY,
      );
      expect(row.id).toBe(seed.id);
      expect(row.deleted_at).toBeNull();
      expect(row.reason).toBe('신');
    });

    it('updateStoreSpecialClosure: closureDate / reason 갱신', async () => {
      const { store } = await setupSellerWithStore(prisma);
      const seed = await prisma.storeSpecialClosure.create({
        data: { store_id: store.id, closure_date: new Date('2026-05-01') },
      });
      const updated = await repo.updateStoreSpecialClosure(
        seed.id,
        {
          closureDate: new Date('2026-05-02'),
          reason: '수정',
        },
        () => AUDIT_ENTRY,
      );
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
      await repo.softDeleteStoreSpecialClosure(seed.id, () => AUDIT_ENTRY);
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

  // write(생성·수정·삭제)는 StoreCapacityRepository — 변경 이벤트를 함께 적재하므로 그쪽 spec이 담당한다
  describe('storeDailyCapacity (findById/list)', () => {
    it('findStoreDailyCapacityById: 본인 매장만', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      const otherCap = await createStoreDailyCapacity(prisma, {
        store_id: other.store.id,
        capacity_date: new Date('2026-06-01'),
        capacity: 1,
      });
      const result = await repo.findStoreDailyCapacityById(
        otherCap.id,
        me.store.id,
      );
      expect(result).toBeNull();
    });

    it('list: fromDate / toDate 필터 + cursor', async () => {
      const { store } = await setupSellerWithStore(prisma);
      for (const [date, capacity] of [
        ['2026-05-30', 10],
        ['2026-06-15', 20],
        ['2026-07-05', 30],
      ] as const) {
        await createStoreDailyCapacity(prisma, {
          store_id: store.id,
          capacity_date: new Date(date),
          capacity,
        });
      }

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
      const row = await repo.createFaqTopic(
        {
          storeId: store.id,
          title: 'Q',
          answerHtml: '<p>A</p>',
          sortOrder: 0,
          isActive: true,
        },
        () => AUDIT_ENTRY,
      );
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

      const updated = await repo.updateFaqTopic(
        {
          topicId: seed.id,
          data: { title: 'new' },
        },
        () => AUDIT_ENTRY,
      );
      expect(updated.title).toBe('new');

      await repo.softDeleteFaqTopic(seed.id, () => AUDIT_ENTRY);
      const after = await prisma.storeFaqTopic.findUnique({
        where: { id: seed.id },
      });
      expect(after?.deleted_at).not.toBeNull();
    });
  });

  describe('isSellerAccount', () => {
    it('SELLER 이면 true, 그 외는 false', () => {
      expect(isSellerAccount(AccountType.SELLER)).toBe(true);
      expect(isSellerAccount(AccountType.USER)).toBe(false);
      expect(isSellerAccount(AccountType.ADMIN)).toBe(false);
    });
  });

  // createStore 팩토리 단독 사용 경로도 한 번 커버해 둔다(미사용 import 방지).
  it('createStore factory 단독 호출도 정상 동작 (factory smoke)', async () => {
    const store = await createStore(prisma);
    expect(store.id).toBeDefined();
  });
});
