import { PubSub } from 'graphql-subscriptions';

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
import { ConversationEventsService } from '@/features/conversation/services/conversation-events.service';
import { SellerConversationService } from '@/features/conversation/services/conversation-seller.service';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { PUB_SUB } from '@/global/pubsub';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SellerConversationService (real DB)', () => {
  let service: SellerConversationService;
  let events: ConversationEventsService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerConversationService,
        StoreSellerRepository,
        ConversationRepository,
        ConversationEventsService,
        { provide: PUB_SUB, useValue: new PubSub() },
        {
          provide: AUDIT_LOG_REPOSITORY,
          useClass: AuditLogRepository,
        },
      ],
    });
    service = module.get(SellerConversationService);
    events = module.get(ConversationEventsService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function setupConversation(
    storeId: bigint,
    overrides: { buyerNickname?: string | null; sellerLastReadAt?: Date } = {},
  ) {
    const customer = await createAccount(prisma, { account_type: 'USER' });
    return prisma.storeConversation.create({
      data: {
        account_id: customer.id,
        store_id: storeId,
        buyer_nickname_snapshot: overrides.buyerNickname ?? null,
        seller_last_read_at: overrides.sellerLastReadAt ?? null,
      },
    });
  }

  function hoursAgo(hours: number): Date {
    return new Date(Date.now() - hours * 60 * 60 * 1000);
  }

  async function addUserMessage(
    conv: { id: bigint; account_id: bigint },
    args: { bodyText?: string; createdAt?: Date } = {},
  ) {
    return prisma.storeConversationMessage.create({
      data: {
        conversation_id: conv.id,
        sender_type: 'USER',
        sender_account_id: conv.account_id,
        body_format: 'TEXT',
        body_text: args.bodyText ?? '문의',
        created_at: args.createdAt ?? new Date(),
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

    it('닉네임 스냅샷·미리보기·판매자 마커·미읽음 수를 매핑하고, 스냅샷 없는 대화는 null', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const marker = hoursAgo(3);
      const named = await setupConversation(store.id, {
        buyerNickname: '현진',
        sellerLastReadAt: marker,
      });
      await addUserMessage(named, {
        createdAt: hoursAgo(4),
        bodyText: '읽은 문의',
      });
      await addUserMessage(named, {
        createdAt: hoursAgo(2),
        bodyText: '새 문의',
      });
      await prisma.storeConversationMessage.create({
        data: {
          conversation_id: named.id,
          sender_type: 'STORE',
          sender_account_id: account.id,
          body_format: 'HTML',
          body_html: '<p>답변 <b>드립니다</b></p>',
          created_at: hoursAgo(1),
        },
      });
      const anonymous = await setupConversation(store.id);

      const result = await service.sellerConversations(account.id);

      const byId = new Map(result.items.map((i) => [i.id, i]));
      expect(byId.get(named.id.toString())).toMatchObject({
        buyerNickname: '현진',
        lastMessagePreview: '답변 드립니다',
        unreadCount: 1,
      });
      expect(byId.get(named.id.toString())?.sellerLastReadAt?.getTime()).toBe(
        marker.getTime(),
      );
      expect(byId.get(anonymous.id.toString())).toMatchObject({
        buyerNickname: null,
        lastMessagePreview: null,
        sellerLastReadAt: null,
        unreadCount: 0,
      });
    });
  });

  describe('sellerMarkConversationRead', () => {
    it('내 매장 대화의 마커를 최신 메시지까지 전진시키고 unreadCount 0을 돌려준다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const conv = await setupConversation(store.id, { buyerNickname: '현진' });
      await addUserMessage(conv, { createdAt: hoursAgo(2) });
      const newest = await addUserMessage(conv, { createdAt: hoursAgo(1) });
      expect(
        (await service.sellerConversations(account.id)).items[0].unreadCount,
      ).toBe(2);

      const result = await service.sellerMarkConversationRead(
        account.id,
        conv.id.toString(),
      );

      expect(result.sellerLastReadAt?.getTime()).toBe(
        newest.created_at.getTime(),
      );
      expect(result).toMatchObject({ buyerNickname: '현진', unreadCount: 0 });
      expect(
        (await service.sellerConversations(account.id)).items[0].unreadCount,
      ).toBe(0);
    });

    it('남의 매장 대화·없는 대화("0")는 CONVERSATION_NOT_FOUND', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      const othersConv = await setupConversation(other.store.id);

      await expect(
        service.sellerMarkConversationRead(
          me.account.id,
          othersConv.id.toString(),
        ),
      ).rejects.toThrowDomain('CONVERSATION_NOT_FOUND');
      await expect(
        service.sellerMarkConversationRead(me.account.id, '0'),
      ).rejects.toThrowDomain('CONVERSATION_NOT_FOUND');
    });

    it('형식이 잘못된 id는 INVALID_ID, USER 계정은 SELLER_ONLY', async () => {
      const { account } = await setupSellerWithStore(prisma);
      const user = await createAccount(prisma, { account_type: 'USER' });

      await expect(
        service.sellerMarkConversationRead(account.id, ''),
      ).rejects.toThrowDomain('INVALID_ID');
      await expect(
        service.sellerMarkConversationRead(user.id, '1'),
      ).rejects.toThrowDomain('SELLER_ONLY');
    });
  });

  describe('sellerConversationMessages', () => {
    it('존재하지 않는 conversationId면 404', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerConversationMessages(account.id, BigInt(999)),
      ).rejects.toThrowDomain(404);
    });

    it('다른 매장 conversation이면 404', async () => {
      const me = await setupSellerWithStore(prisma);
      const other = await setupSellerWithStore(prisma);
      const conv = await setupConversation(other.store.id);

      await expect(
        service.sellerConversationMessages(me.account.id, conv.id),
      ).rejects.toThrowDomain(404);
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
    it('존재하지 않는 conversationId면 404', async () => {
      const { account } = await setupSellerWithStore(prisma);
      await expect(
        service.sellerSendConversationMessage(account.id, {
          conversationId: '999999',
          bodyFormat: 'TEXT',
          bodyText: 'x',
        }),
      ).rejects.toThrowDomain(404);
    });

    it('잘못된 bodyFormat이면 400', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const conv = await setupConversation(store.id);
      await expect(
        service.sellerSendConversationMessage(account.id, {
          conversationId: conv.id.toString(),
          bodyFormat: 'INVALID' as never,
          bodyText: 'x',
        }),
      ).rejects.toThrowDomain(400);
    });

    it('TEXT 포맷인데 bodyText 없음 → 400', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const conv = await setupConversation(store.id);
      await expect(
        service.sellerSendConversationMessage(account.id, {
          conversationId: conv.id.toString(),
          bodyFormat: 'TEXT',
        }),
      ).rejects.toThrowDomain(400);
    });

    it('HTML 포맷인데 bodyHtml 없음 → 400', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const conv = await setupConversation(store.id);
      await expect(
        service.sellerSendConversationMessage(account.id, {
          conversationId: conv.id.toString(),
          bodyFormat: 'HTML',
        }),
      ).rejects.toThrowDomain(400);
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

    it('답장 뒤 목록 미읽음은 0이고, 판매자 이벤트에 닉네임·마커·미읽음 0이 실린다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const conv = await setupConversation(store.id, { buyerNickname: '현진' });
      await addUserMessage(conv, { createdAt: hoursAgo(1) });
      const publishSeller = jest.spyOn(events, 'publishSellerListUpdate');

      const reply = await service.sellerSendConversationMessage(account.id, {
        conversationId: conv.id.toString(),
        bodyFormat: 'TEXT',
        bodyText: '답장',
      });

      expect(
        (await service.sellerConversations(account.id)).items[0],
      ).toMatchObject({
        unreadCount: 0,
        lastMessagePreview: '답장',
      });
      expect(publishSeller).toHaveBeenCalledWith(store.id.toString(), {
        conversationId: conv.id.toString(),
        accountId: conv.account_id.toString(),
        buyerNickname: '현진',
        lastMessagePreview: '답장',
        lastMessageAt: reply.createdAt.toISOString(),
        sellerLastReadAt: reply.createdAt.toISOString(),
        unreadCount: 0,
      });
      publishSeller.mockRestore();
    });
  });

  describe('sellerConversations / sellerConversationMessages cursor 분기', () => {
    it('sellerConversations: cursor 기반 두 번째 페이지를 반환한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      for (let i = 0; i < 3; i++) await setupConversation(store.id);

      const first = await service.sellerConversations(account.id, { limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();

      const second = await service.sellerConversations(account.id, {
        limit: 2,
        cursor: first.nextCursor as string,
      });
      expect(second.items.length).toBeGreaterThanOrEqual(1);
    });

    it('sellerConversationMessages: cursor 기반 두 번째 페이지를 반환한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const conv = await setupConversation(store.id);
      for (let i = 0; i < 3; i++) {
        await prisma.storeConversationMessage.create({
          data: {
            conversation_id: conv.id,
            sender_type: 'STORE',
            sender_account_id: account.id,
            body_format: 'TEXT',
            body_text: `msg ${i}`,
          },
        });
      }
      const first = await service.sellerConversationMessages(
        account.id,
        conv.id,
        { limit: 2 },
      );
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();

      const second = await service.sellerConversationMessages(
        account.id,
        conv.id,
        { limit: 2, cursor: first.nextCursor as string },
      );
      expect(second.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('toConversationMessageOutput senderAccountId null 분기', () => {
    it('SYSTEM 메시지처럼 sender_account_id가 null이면 출력도 null', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const conv = await setupConversation(store.id);
      await prisma.storeConversationMessage.create({
        data: {
          conversation_id: conv.id,
          sender_type: 'SYSTEM',
          sender_account_id: null,
          body_format: 'TEXT',
          body_text: '시스템 알림',
        },
      });

      const result = await service.sellerConversationMessages(
        account.id,
        conv.id,
      );
      const systemMsg = result.items.find((m) => m.senderType === 'SYSTEM');
      expect(systemMsg).toBeDefined();
      expect(systemMsg!.senderAccountId).toBeNull();
    });
  });
});
