import { StoreCatalogQueryRepository } from '@/features/store/repositories/store-catalog-query.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// conversation이 쓰는 CatalogQuery 포트 계약 — 노출 범위(활성·미삭제)와 정렬은 repository에서만 결정된다.
describe('StoreCatalogQueryRepository (real DB)', () => {
  let repo: StoreCatalogQueryRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [StoreCatalogQueryRepository],
    });
    repo = module.get(StoreCatalogQueryRepository);
    prisma = p;
  });
  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  async function addFaq(
    storeId: bigint,
    title: string,
    overrides: { sort_order?: number; is_active?: boolean } = {},
  ) {
    return prisma.storeFaqTopic.create({
      data: {
        store_id: storeId,
        title,
        answer_html: `<p>${title}</p>`,
        sort_order: overrides.sort_order ?? 0,
        is_active: overrides.is_active ?? true,
      },
    });
  }

  describe('findInquiryStore', () => {
    it('노출 가능한 매장의 컨텍스트와 활성 영업시간(요일 순)을 반환한다', async () => {
      const store = await createStore(prisma, {
        store_name: '문의 매장',
        greeting_message: '{nickname}님 환영',
      });
      for (const day of [3, 1]) {
        await prisma.storeBusinessHour.create({
          data: { store_id: store.id, day_of_week: day, is_closed: day === 3 },
        });
      }
      await prisma.storeBusinessHour.create({
        data: { store_id: store.id, day_of_week: 2, deleted_at: new Date() },
      });

      const row = await repo.findInquiryStore(store.id);

      expect(row).toMatchObject({
        id: store.id,
        store_name: '문의 매장',
        greeting_message: '{nickname}님 환영',
      });
      expect(row!.business_hours.map((h) => h.day_of_week)).toEqual([1, 3]);
    });

    it.each([
      ['비활성 매장', { is_active: false }],
      ['삭제된 매장', { deleted_at: new Date() }],
    ])('%s은 null', async (_label, overrides) => {
      const store = await createStore(prisma, overrides);
      expect(await repo.findInquiryStore(store.id)).toBeNull();
    });
  });

  describe('listActiveFaqTopics / findActiveFaqTopic', () => {
    it('활성 주제만 sort_order·id 순으로 돌려주고, 단건은 매장 범위 안에서만 찾는다', async () => {
      const store = await createStore(prisma);
      const other = await createStore(prisma);
      const second = await addFaq(store.id, '둘째', { sort_order: 1 });
      const first = await addFaq(store.id, '첫째', { sort_order: 0 });
      await addFaq(store.id, '비활성', { is_active: false });
      const foreign = await addFaq(other.id, '남의 매장');

      expect(
        (await repo.listActiveFaqTopics(store.id)).map((t) => t.title),
      ).toEqual(['첫째', '둘째']);
      expect(
        await repo.findActiveFaqTopic({
          storeId: store.id,
          faqTopicId: second.id,
        }),
      ).toEqual({ id: second.id, title: '둘째', answer_html: '<p>둘째</p>' });
      expect(
        await repo.findActiveFaqTopic({
          storeId: store.id,
          faqTopicId: foreign.id,
        }),
      ).toBeNull();
      expect(first.id).not.toBe(second.id);
    });
  });
});
