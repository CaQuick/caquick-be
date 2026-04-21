import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ConversationRepository } from '@/features/conversation';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerConversationService } from '@/features/seller/services/seller-conversation.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SellerConversationService (real DB)', () => {
  let service: SellerConversationService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerConversationService,
        SellerRepository,
        ConversationRepository,
      ],
    });
    service = module.get(SellerConversationService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function setupConversation(storeId: bigint) {
    const customer = await createAccount(prisma, { account_type: 'USER' });
    return prisma.storeConversation.create({
      data: {
        account_id: customer.id,
        store_id: storeId,
      },
    });
  }

  describe('sellerConversations', () => {
    it('자기 매장 대화만 반환한다', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      await setupConversation(me.store.id);
      await setupConversation(other.store.id);

      const result = await service.sellerConversations(me.account.id);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].storeId).toBe(me.store.id.toString());
    });

    it('limit 초과 시 nextCursor를 반환한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      for (let i = 0; i < 3; i++) await setupConversation(store.id);

      const result = await service.sellerConversations(account.id, {
        limit: 2,
      });
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).not.toBeNull();
    });
  });

  describe('sellerConversationMessages', () => {
    it('존재하지 않는 conversationId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerConversationMessages(account.id, BigInt(999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('다른 매장 conversation이면 NotFoundException', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      const conv = await setupConversation(other.store.id);

      await expect(
        service.sellerConversationMessages(me.account.id, conv.id),
      ).rejects.toThrow(NotFoundException);
    });

    it('자기 conversation의 메시지 목록 반환', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const conv = await setupConversation(store.id);
      await prisma.storeConversationMessage.create({
        data: {
          conversation_id: conv.id,
          sender_type: 'USER',
          sender_account_id: conv.account_id,
          body_format: 'TEXT',
          body_text: '안녕하세요',
        },
      });

      const result = await service.sellerConversationMessages(
        account.id,
        conv.id,
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0].bodyText).toBe('안녕하세요');
    });
  });

  describe('sellerSendConversationMessage', () => {
    it('존재하지 않는 conversationId면 NotFoundException', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerSendConversationMessage(account.id, {
          conversationId: '999999',
          bodyFormat: 'TEXT',
          bodyText: 'x',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('잘못된 bodyFormat이면 BadRequestException', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const conv = await setupConversation(store.id);
      await expect(
        service.sellerSendConversationMessage(account.id, {
          conversationId: conv.id.toString(),
          bodyFormat: 'INVALID' as never,
          bodyText: 'x',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('TEXT 포맷인데 bodyText 없음 → BadRequestException', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const conv = await setupConversation(store.id);
      await expect(
        service.sellerSendConversationMessage(account.id, {
          conversationId: conv.id.toString(),
          bodyFormat: 'TEXT',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('HTML 포맷인데 bodyHtml 없음 → BadRequestException', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const conv = await setupConversation(store.id);
      await expect(
        service.sellerSendConversationMessage(account.id, {
          conversationId: conv.id.toString(),
          bodyFormat: 'HTML',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('정상 TEXT 메시지 전송 + conversation.last_message_at 갱신 + audit log', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const conv = await setupConversation(store.id);

      const result = await service.sellerSendConversationMessage(account.id, {
        conversationId: conv.id.toString(),
        bodyFormat: 'TEXT',
        bodyText: '판매자 답장',
      });

      expect(result.bodyText).toBe('판매자 답장');
      expect(result.senderType).toBe('STORE');

      const messages = await prisma.storeConversationMessage.findMany({
        where: { conversation_id: conv.id },
      });
      expect(messages).toHaveLength(1);

      const updatedConv = await prisma.storeConversation.findUniqueOrThrow({
        where: { id: conv.id },
      });
      expect(updatedConv.last_message_at).not.toBeNull();

      const auditLogs = await prisma.auditLog.findMany({
        where: { store_id: store.id, target_type: 'CONVERSATION' },
      });
      expect(auditLogs).toHaveLength(1);
    });
  });
});
