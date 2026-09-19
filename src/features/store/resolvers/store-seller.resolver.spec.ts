import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { StoreCapacityRepository } from '@/features/store/repositories/store-capacity.repository';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import { SellerStoreMutationResolver } from '@/features/store/resolvers/store-seller-mutation.resolver';
import { SellerStoreQueryResolver } from '@/features/store/resolvers/store-seller-query.resolver';
import { SellerFaqService } from '@/features/store/services/store-seller-faq.service';
import { SellerStoreHoursService } from '@/features/store/services/store-seller-hours.service';
import { SellerStorePolicyService } from '@/features/store/services/store-seller-policy.service';
import { SellerStoreProfileService } from '@/features/store/services/store-seller-profile.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';
import { s3TestProviders } from '@/test/storage/s3-test.helper';

describe('Seller Store Resolvers (real DB)', () => {
  let queryResolver: SellerStoreQueryResolver;
  let mutationResolver: SellerStoreMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ...s3TestProviders(),
        SellerStoreQueryResolver,
        SellerStoreMutationResolver,
        SellerStoreProfileService,
        SellerStoreHoursService,
        SellerStorePolicyService,
        SellerFaqService,
        StoreSellerRepository,
        // capacity write는 변경 이벤트를 함께 적재한다(D7-a)
        StoreCapacityRepository,
        ...outboxPublisherProviders(),
        {
          provide: AUDIT_LOG_REPOSITORY,
          useClass: AuditLogRepository,
        },
      ],
    });
    queryResolver = module.get(SellerStoreQueryResolver);
    mutationResolver = module.get(SellerStoreMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('Query.sellerMyStore: DB에서 본인 매장 반환', async () => {
    const { account, store } = await setupSellerWithStore(prisma, {
      storeName: '내 가게',
    });
    const result = await queryResolver.sellerMyStore({
      accountId: account.id.toString(),
    });
    expect(result.id).toBe(store.id.toString());
    expect(result.storeName).toBe('내 가게');
  });

  it('Mutation.sellerUpdateStoreBasicInfo: 수정 반영 및 audit log 생성', async () => {
    const { account, store } = await setupSellerWithStore(prisma);
    const result = await mutationResolver.sellerUpdateStoreBasicInfo(
      { accountId: account.id.toString() },
      { storeName: '변경됨' },
    );
    expect(result.storeName).toBe('변경됨');

    const auditLogs = await prisma.auditLog.findMany({
      where: { store_id: store.id },
    });
    expect(auditLogs).toHaveLength(1);
  });

  it('Mutation.sellerUpsertStoreBusinessHour 서비스 예외 전파 (SELLER 아님)', async () => {
    const userAccount = await prisma.account.create({
      data: { account_type: 'USER', email: 'x@x.com', name: 'u' },
    });
    await expect(
      mutationResolver.sellerUpsertStoreBusinessHour(
        { accountId: userAccount.id.toString() },
        {
          dayOfWeek: 1,
          isClosed: true,
          openTime: null,
          closeTime: null,
        },
      ),
    ).rejects.toThrow();
  });

  it('Query.sellerStoreSpecialClosures: 본인 store 휴무 목록 반환', async () => {
    const { account, store } = await setupSellerWithStore(prisma);
    await prisma.storeSpecialClosure.create({
      data: { store_id: store.id, closure_date: new Date('2026-04-01') },
    });
    const result = await queryResolver.sellerStoreSpecialClosures({
      accountId: account.id.toString(),
    });
    expect(result.items).toHaveLength(1);
  });

  it('Mutation.sellerDeleteStoreSpecialClosure: 타인 closure 접근은 404', async () => {
    const me = await setupSellerWithStore(prisma);
    const other = await setupSellerWithStore(prisma);
    const othersClosure = await prisma.storeSpecialClosure.create({
      data: { store_id: other.store.id, closure_date: new Date('2026-04-01') },
    });

    await expect(
      mutationResolver.sellerDeleteStoreSpecialClosure(
        { accountId: me.account.id.toString() },
        othersClosure.id.toString(),
      ),
    ).rejects.toThrowDomain(404);
  });
  it('Mutation.sellerCreateFaqTopic + Query.sellerFaqTopics: DB 왕복 반영', async () => {
    const { account } = await setupSellerWithStore(prisma);
    await mutationResolver.sellerCreateFaqTopic(
      { accountId: account.id.toString() },
      { title: 'F1', answerHtml: '<p>a</p>' },
    );
    const result = await queryResolver.sellerFaqTopics({
      accountId: account.id.toString(),
    });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('F1');
  });

  it('Mutation.sellerDeleteFaqTopic: 타 매장 topic이면 404 전파', async () => {
    const me = await setupSellerWithStore(prisma);
    const other = await setupSellerWithStore(prisma);
    const othersFaq = await prisma.storeFaqTopic.create({
      data: { store_id: other.store.id, title: 'X', answer_html: '<p>x</p>' },
    });

    await expect(
      mutationResolver.sellerDeleteFaqTopic(
        { accountId: me.account.id.toString() },
        othersFaq.id.toString(),
      ),
    ).rejects.toThrowDomain(404);
  });
});
