// 전체 경로(리졸버→서비스→레포→DB) 통합 검증만 담당. 분기/집계 세부 검증은 service.spec.ts에서 담당
import type { PrismaClient } from '@prisma/client';
import { PubSub } from 'graphql-subscriptions';

import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
import { ConversationCenterQueryResolver } from '@/features/conversation/resolvers/conversation-center-query.resolver';
import { ConversationInquiryMutationResolver } from '@/features/conversation/resolvers/conversation-inquiry-mutation.resolver';
import { ConversationCenterService } from '@/features/conversation/services/conversation-center.service';
import { ConversationEventsService } from '@/features/conversation/services/conversation-events.service';
import { ConversationInquiryService } from '@/features/conversation/services/conversation-inquiry.service';
import { PUB_SUB } from '@/global/pubsub';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('Conversation Center Resolvers (real DB)', () => {
  let centerResolver: ConversationCenterQueryResolver;
  let inquiryMutationResolver: ConversationInquiryMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ConversationCenterQueryResolver,
        ConversationInquiryMutationResolver,
        ConversationCenterService,
        ConversationInquiryService,
        ConversationRepository,
        ConversationEventsService,
        { provide: PUB_SUB, useValue: new PubSub() },
      ],
    });
    centerResolver = module.get(ConversationCenterQueryResolver);
    inquiryMutationResolver = module.get(ConversationInquiryMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('전송 → 목록 → 상세 조회 전체 경로가 안읽음 수까지 일관된다', async () => {
    const buyer = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: buyer.id });
    const store = await createStore(prisma, { store_name: '해즈 케이크' });
    const jwtUser = { accountId: buyer.id.toString() };

    const sent = await inquiryMutationResolver.sendConversationMessage(
      jwtUser,
      { storeId: store.id.toString(), bodyText: '픽업 문의드립니다' },
    );

    const list = await centerResolver.myConversations(jwtUser);
    expect(list.totalCount).toBe(1);
    expect(list.items[0]).toMatchObject({
      id: sent.conversationId,
      storeName: '해즈 케이크',
      lastMessagePreview: '픽업 문의드립니다',
    });

    const messages = await centerResolver.conversationMessages(
      jwtUser,
      sent.conversationId,
    );
    // 인사말 + 유저 메시지 (최신순)
    expect(messages.totalCount).toBe(2);
    expect(messages.items.map((m) => m.senderType)).toEqual(['USER', 'STORE']);
  });
});
