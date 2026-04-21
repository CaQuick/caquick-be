import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ConversationRepository } from '@/features/conversation';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerConversationMutationResolver } from '@/features/seller/resolvers/seller-conversation-mutation.resolver';
import { SellerConversationQueryResolver } from '@/features/seller/resolvers/seller-conversation-query.resolver';
import { SellerConversationService } from '@/features/seller/services/seller-conversation.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('Seller Conversation Resolvers (real DB)', () => {
  let queryResolver: SellerConversationQueryResolver;
  let mutationResolver: SellerConversationMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerConversationQueryResolver,
        SellerConversationMutationResolver,
        SellerConversationService,
        SellerRepository,
        ConversationRepository,
      ],
    });
    queryResolver = module.get(SellerConversationQueryResolver);
    mutationResolver = module.get(SellerConversationMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function createConv(storeId: bigint) {
    const customer = await createAccount(prisma, { account_type: 'USER' });
    return prisma.storeConversation.create({
      data: { account_id: customer.id, store_id: storeId },
    });
  }

  it('Query.sellerConversations: 본인 store의 conversation만 반환', async () => {
    const me = await setupSellerWithStore(prisma);
    const other = await setupSellerWithStore(prisma);
    await createConv(me.store.id);
    await createConv(other.store.id);

    const result = await queryResolver.sellerConversations({
      accountId: me.account.id.toString(),
    });
    expect(result.items).toHaveLength(1);
  });

  it('Mutation.sellerSendConversationMessage: 타 store conversation은 NotFoundException 전파', async () => {
    const me = await setupSellerWithStore(prisma);
    const other = await setupSellerWithStore(prisma);
    const othersConv = await createConv(other.store.id);

    await expect(
      mutationResolver.sellerSendConversationMessage(
        { accountId: me.account.id.toString() },
        {
          conversationId: othersConv.id.toString(),
          bodyFormat: 'TEXT',
          bodyText: 'x',
        } as never,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
