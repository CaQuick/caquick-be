import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PubSub } from 'graphql-subscriptions';

import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
import { ConversationEventsService } from '@/features/conversation/services/conversation-events.service';
import { ConversationInquiryService } from '@/features/conversation/services/conversation-inquiry.service';
import { ConversationSubscriptionService } from '@/features/conversation/services/conversation-subscription.service';
import { PUB_SUB } from '@/global/pubsub';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('ConversationSubscriptionService (real DB)', () => {
  let service: ConversationSubscriptionService;
  let inquiryService: ConversationInquiryService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ConversationSubscriptionService,
        ConversationInquiryService,
        ConversationEventsService,
        ConversationRepository,
        // 발행-구독 왕복은 실 Redis spec(events service) 담당 — 여기선 in-memory
        { provide: PUB_SUB, useValue: new PubSub() },
      ],
    });
    service = module.get(ConversationSubscriptionService);
    inquiryService = module.get(ConversationInquiryService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function setupBuyer() {
    const account = await createAccount(prisma, { account_type: 'USER' });
    await createUserProfile(prisma, { account_id: account.id });
    return account;
  }

  describe('subscribeConversationMessages', () => {
    it('대화 소유 구매자와 해당 매장 판매자는 구독할 수 있고, 제3자는 NotFound', async () => {
      const buyer = await setupBuyer();
      const stranger = await setupBuyer();
      const seller = await createAccount(prisma, { account_type: 'SELLER' });
      const store = await createStore(prisma, {
        seller_account_id: seller.id,
      });
      const conversation = await prisma.storeConversation.create({
        data: { account_id: buyer.id, store_id: store.id },
      });
      const id = conversation.id.toString();

      await expect(
        service.subscribeConversationMessages(buyer.id, id),
      ).resolves.toBeDefined();
      await expect(
        service.subscribeConversationMessages(seller.id, id),
      ).resolves.toBeDefined();
      await expect(
        service.subscribeConversationMessages(stranger.id, id),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.subscribeConversationMessages(buyer.id, '999999'),
      ).rejects.toThrow(NotFoundException);
    });

    it('구독 중이면 구매자 전송 이벤트를 실제로 수신한다(발행 경로 통합)', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma, { store_name: '해즈 케이크' });

      // 첫 전송으로 대화 생성 → 그 대화를 구독 → 두 번째 전송 수신 확인
      const first = await inquiryService.sendConversationMessage(buyer.id, {
        storeId: store.id.toString(),
        bodyText: '첫 문의',
      });
      const iterator = await service.subscribeConversationMessages(
        buyer.id,
        first.conversationId,
      );
      const pending = iterator.next();

      await inquiryService.sendConversationMessage(buyer.id, {
        storeId: store.id.toString(),
        bodyText: '추가 문의',
      });

      const { value } = await pending;
      expect(value).toMatchObject({
        conversationId: first.conversationId,
        senderType: 'USER',
        bodyText: '추가 문의',
      });
      await iterator.return?.();
    });
  });

  describe('subscribeMyConversationUpdates', () => {
    it('활성 USER만 구독 가능하고, 전송 시 목록 갱신 이벤트를 수신한다', async () => {
      const buyer = await setupBuyer();
      const seller = await createAccount(prisma, { account_type: 'SELLER' });
      const store = await createStore(prisma, { store_name: '달콤 케이크' });

      await expect(
        service.subscribeMyConversationUpdates(BigInt(999999)),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.subscribeMyConversationUpdates(seller.id),
      ).rejects.toThrow(ForbiddenException);

      const iterator = await service.subscribeMyConversationUpdates(buyer.id);
      const pending = iterator.next();

      await inquiryService.sendConversationMessage(buyer.id, {
        storeId: store.id.toString(),
        bodyText: '문의합니다',
      });

      const { value } = await pending;
      expect(value).toMatchObject({
        storeId: store.id.toString(),
        storeName: '달콤 케이크',
        lastMessagePreview: '문의합니다',
        // 인사말은 mutation 응답으로 즉시 표시돼 읽음 처리된다
        unreadCount: 0,
      });
      await iterator.return?.();
    });
  });

  describe('subscribeSellerConversationUpdates', () => {
    it('매장 보유 판매자만 구독 가능하고, 고객 전송 이벤트를 수신한다', async () => {
      const buyer = await setupBuyer();
      const seller = await createAccount(prisma, { account_type: 'SELLER' });
      const store = await createStore(prisma, {
        seller_account_id: seller.id,
      });

      // 매장 없는 계정은 구독 불가
      await expect(
        service.subscribeSellerConversationUpdates(buyer.id),
      ).rejects.toThrow(NotFoundException);

      const iterator = await service.subscribeSellerConversationUpdates(
        seller.id,
      );
      const pending = iterator.next();

      await inquiryService.sendConversationMessage(buyer.id, {
        storeId: store.id.toString(),
        bodyText: '픽업 시간 문의',
      });

      const { value } = await pending;
      expect(value).toMatchObject({
        accountId: buyer.id.toString(),
        lastMessagePreview: '픽업 시간 문의',
      });
      await iterator.return?.();
    });
  });
});
