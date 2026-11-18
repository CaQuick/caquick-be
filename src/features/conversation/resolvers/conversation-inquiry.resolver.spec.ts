// 전체 경로(리졸버→서비스→레포→DB) 통합 검증만 담당. 분기·예외 세부는 service.spec.ts에서 담당
import { PubSub } from 'graphql-subscriptions';

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountUserRepository } from '@/features/auth';
import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
import { ConversationInquiryMutationResolver } from '@/features/conversation/resolvers/conversation-inquiry-mutation.resolver';
import { ConversationInquiryQueryResolver } from '@/features/conversation/resolvers/conversation-inquiry-query.resolver';
import { ConversationEventsService } from '@/features/conversation/services/conversation-events.service';
import { ConversationInquiryService } from '@/features/conversation/services/conversation-inquiry.service';
import { OrderInquiryRepository } from '@/features/order';
import { CATALOG_QUERY } from '@/features/store';
import { StoreCatalogQueryRepository } from '@/features/store/repositories/store-catalog-query.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { PUB_SUB } from '@/global/pubsub';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';
import { s3TestProviders } from '@/test/storage/s3-test.helper';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-presigned-url.com'),
}));

describe('Conversation Inquiry Resolvers (real DB)', () => {
  let queryResolver: ConversationInquiryQueryResolver;
  let mutationResolver: ConversationInquiryMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ConversationInquiryQueryResolver,
        ConversationInquiryMutationResolver,
        ConversationInquiryService,
        ConversationRepository,
        // 발행 repository가 OutboxPublisher를 주입받는다
        ...outboxPublisherProviders(),
        ConversationEventsService,
        OrderInquiryRepository,
        ...s3TestProviders(),
        AccountUserRepository,
        { provide: CATALOG_QUERY, useClass: StoreCatalogQueryRepository },
        { provide: PUB_SUB, useValue: new PubSub() },
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    queryResolver = module.get(ConversationInquiryQueryResolver);
    mutationResolver = module.get(ConversationInquiryMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('Query.storeInquiryContext → Mutation.sendConversationMessage 전체 경로', async () => {
    const buyer = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: buyer.id, nickname: '현진' });
    const store = await createStore(prisma, { store_name: '해즈 케이크' });
    const jwtUser = { accountId: buyer.id.toString() };

    const context = await queryResolver.storeInquiryContext(
      jwtUser,
      store.id.toString(),
    );
    expect(context.storeName).toBe('해즈 케이크');
    expect(context.conversationId).toBeNull();

    const sent = await mutationResolver.sendConversationMessage(jwtUser, {
      storeId: store.id.toString(),
      bodyText: '픽업 문의드립니다',
    });
    expect(sent.messages.map((m) => m.senderType)).toEqual(['STORE', 'USER']);

    const after = await queryResolver.storeInquiryContext(
      jwtUser,
      store.id.toString(),
    );
    expect(after.conversationId).toBe(sent.conversationId);
  });

  it('Mutation.sendConversationFaqMessage가 질문+자동응답을 저장한다', async () => {
    const buyer = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: buyer.id });
    const store = await createStore(prisma);
    const faq = await prisma.storeFaqTopic.create({
      data: {
        store_id: store.id,
        title: '예약 가능 일정',
        answer_html: '<p>캘린더를 확인해 주세요.</p>',
      },
    });

    const result = await mutationResolver.sendConversationFaqMessage(
      { accountId: buyer.id.toString() },
      { storeId: store.id.toString(), faqTopicId: faq.id.toString() },
    );

    expect(result.messages).toHaveLength(3);
    expect(result.messages[2].bodyHtml).toBe('<p>캘린더를 확인해 주세요.</p>');
  });

  it('이미지 업로드 URL 발급 → 이미지 메시지, 주문 카드 전송 전체 경로', async () => {
    const buyer = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: buyer.id });
    const store = await createStore(prisma);
    const order = await createOrder(prisma, {
      account_id: buyer.id,
      status: 'CONFIRMED',
    });
    await createOrderItem(prisma, { order_id: order.id, store_id: store.id });
    const jwtUser = { accountId: buyer.id.toString() };

    const upload = await mutationResolver.createConversationImageUploadUrl(
      jwtUser,
      'image/jpeg',
      1024,
    );
    const image = await mutationResolver.sendConversationImageMessage(jwtUser, {
      storeId: store.id.toString(),
      imageUrl: upload.publicUrl,
    });
    const card = await mutationResolver.sendConversationOrderCard(
      jwtUser,
      order.id.toString(),
    );

    expect(image.messages.at(-1)?.imageUrl).toBe(upload.publicUrl);
    expect(card.conversationId).toBe(image.conversationId);
    expect(card.messages).toEqual([
      expect.objectContaining({
        bodyFormat: 'ORDER_CARD',
        orderCard: expect.objectContaining({ orderId: order.id.toString() }),
      }),
    ]);
  });
});
