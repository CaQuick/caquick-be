import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerStoreMutationResolver } from '@/features/seller/resolvers/seller-store-mutation.resolver';
import { SellerStoreQueryResolver } from '@/features/seller/resolvers/seller-store-query.resolver';
import { SellerStoreService } from '@/features/seller/services/seller-store.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('Seller Store Resolvers (real DB)', () => {
  let queryResolver: SellerStoreQueryResolver;
  let mutationResolver: SellerStoreMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerStoreQueryResolver,
        SellerStoreMutationResolver,
        SellerStoreService,
        SellerRepository,
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
      { storeName: '변경됨' } as never,
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
        } as never,
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

  it('Mutation.sellerDeleteStoreSpecialClosure: 타인 closure 접근은 NotFoundException', async () => {
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
    ).rejects.toThrow(NotFoundException);
  });
});
