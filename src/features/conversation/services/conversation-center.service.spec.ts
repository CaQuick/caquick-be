import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
import { ConversationCenterService } from '@/features/conversation/services/conversation-center.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createStore,
  createUserProfile,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('ConversationCenterService (real DB)', () => {
  let service: ConversationCenterService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [ConversationCenterService, ConversationRepository],
    });
    service = module.get(ConversationCenterService);
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

  function hoursAgo(hours: number): Date {
    return new Date(Date.now() - hours * 60 * 60 * 1000);
  }

  async function makeConversation(args: {
    accountId: bigint;
    storeId: bigint;
    lastMessageAt?: Date | null;
    lastReadAt?: Date | null;
  }) {
    return prisma.storeConversation.create({
      data: {
        account_id: args.accountId,
        store_id: args.storeId,
        last_message_at:
          args.lastMessageAt === undefined ? new Date() : args.lastMessageAt,
        last_read_at: args.lastReadAt ?? null,
      },
    });
  }

  async function addMessage(args: {
    conversationId: bigint;
    senderType?: 'USER' | 'STORE' | 'SYSTEM';
    bodyFormat?: 'TEXT' | 'HTML';
    bodyText?: string | null;
    bodyHtml?: string | null;
    createdAt?: Date;
    senderAccountId?: bigint;
  }) {
    return prisma.storeConversationMessage.create({
      data: {
        conversation_id: args.conversationId,
        sender_type: args.senderType ?? 'STORE',
        sender_account_id: args.senderAccountId ?? null,
        body_format: args.bodyFormat ?? 'TEXT',
        body_text:
          args.bodyText === undefined ? '메시지' : args.bodyText,
        body_html: args.bodyHtml ?? null,
        created_at: args.createdAt ?? new Date(),
      },
    });
  }

  // ─── myConversations ───
  describe('myConversations', () => {
    it('마지막 메시지 최신순으로 매장 정보·미리보기·안읽음 수를 반환한다', async () => {
      const buyer = await setupBuyer();
      const storeA = await createStore(prisma, {
        store_name: '해즈 케이크',
        profile_image_url: 'https://cdn.example.com/hs.png',
      });
      const storeB = await createStore(prisma, { store_name: '달콤 케이크' });

      // storeA: 최근 대화, 안읽은 STORE 메시지 3건
      const convA = await makeConversation({
        accountId: buyer.id,
        storeId: storeA.id,
        lastMessageAt: hoursAgo(1),
        lastReadAt: hoursAgo(5),
      });
      await addMessage({
        conversationId: convA.id,
        senderType: 'USER',
        bodyText: '문의합니다',
        createdAt: hoursAgo(6),
        senderAccountId: buyer.id,
      });
      for (let i = 0; i < 3; i++) {
        await addMessage({
          conversationId: convA.id,
          bodyText: `답변 ${i + 1}`,
          createdAt: hoursAgo(4 - i),
        });
      }

      // storeB: 오래된 대화, 전부 읽음. 마지막 메시지는 HTML
      const convB = await makeConversation({
        accountId: buyer.id,
        storeId: storeB.id,
        lastMessageAt: hoursAgo(24),
        lastReadAt: hoursAgo(23),
      });
      await addMessage({
        conversationId: convB.id,
        bodyFormat: 'HTML',
        bodyText: null,
        bodyHtml: '<p>🎂 <strong>케이크 보관 방법</strong></p><p>냉장 3일</p>',
        createdAt: hoursAgo(24),
      });

      const result = await service.myConversations(buyer.id);

      expect(result.totalCount).toBe(2);
      expect(result.items.map((i) => i.storeName)).toEqual([
        '해즈 케이크',
        '달콤 케이크',
      ]);
      expect(result.items[0]).toMatchObject({
        id: convA.id.toString(),
        storeId: storeA.id.toString(),
        storeProfileImageUrl: 'https://cdn.example.com/hs.png',
        lastMessagePreview: '답변 3',
        unreadCount: 3,
      });
      // HTML 마지막 메시지는 태그를 제거한 미리보기
      expect(result.items[1]).toMatchObject({
        lastMessagePreview: '🎂 케이크 보관 방법 냉장 3일',
        unreadCount: 0,
      });
    });

    it('내가 보낸 메시지는 안읽음 수에 세지 않는다', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);
      const conv = await makeConversation({
        accountId: buyer.id,
        storeId: store.id,
        lastReadAt: null,
      });
      await addMessage({
        conversationId: conv.id,
        senderType: 'USER',
        senderAccountId: buyer.id,
      });
      await addMessage({ conversationId: conv.id, senderType: 'STORE' });

      const result = await service.myConversations(buyer.id);

      // last_read_at이 null이면 수신 메시지 전부가 안읽음
      expect(result.items[0].unreadCount).toBe(1);
    });

    it('커서로 다음 페이지를 이어가고, 메시지 없는 대화는 제외한다', async () => {
      const buyer = await setupBuyer();
      const convIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const store = await createStore(prisma);
        const conv = await makeConversation({
          accountId: buyer.id,
          storeId: store.id,
          lastMessageAt: hoursAgo(i + 1),
        });
        convIds.push(conv.id.toString());
      }
      // 메시지 없는(빈) 대화 — 목록 비노출
      const emptyStore = await createStore(prisma);
      await makeConversation({
        accountId: buyer.id,
        storeId: emptyStore.id,
        lastMessageAt: null,
      });

      const page1 = await service.myConversations(buyer.id, { limit: 2 });
      expect(page1.totalCount).toBe(3);
      expect(page1.hasMore).toBe(true);
      expect(page1.items.map((i) => i.id)).toEqual([convIds[0], convIds[1]]);

      const page2 = await service.myConversations(buyer.id, {
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items.map((i) => i.id)).toEqual([convIds[2]]);
      expect(page2.hasMore).toBe(false);
      expect(page2.nextCursor).toBeNull();
    });

    it('형식이 잘못된 커서는 거절하고, 다른 계정 대화는 노출하지 않는다', async () => {
      const buyer = await setupBuyer();
      const other = await setupBuyer();
      const store = await createStore(prisma);
      await makeConversation({ accountId: other.id, storeId: store.id });

      await expect(
        service.myConversations(buyer.id, { cursor: 'abc' }),
      ).rejects.toThrow(BadRequestException);

      const result = await service.myConversations(buyer.id);
      expect(result.totalCount).toBe(0);
      expect(result.items).toHaveLength(0);
    });
  });

  // ─── conversationMessages ───
  describe('conversationMessages', () => {
    it('메시지를 최신순 키셋 커서로 반환하고, 조회 시 last_read_at을 갱신한다', async () => {
      const buyer = await setupBuyer();
      const store = await createStore(prisma);
      const conv = await makeConversation({
        accountId: buyer.id,
        storeId: store.id,
        lastReadAt: null,
      });
      const msgIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const m = await addMessage({
          conversationId: conv.id,
          bodyText: `메시지 ${i + 1}`,
        });
        msgIds.push(m.id.toString());
      }

      const page1 = await service.conversationMessages(
        buyer.id,
        conv.id.toString(),
        { limit: 2 },
      );
      expect(page1.totalCount).toBe(3);
      expect(page1.hasMore).toBe(true);
      // 최신(id desc)부터
      expect(page1.items.map((m) => m.id)).toEqual([msgIds[2], msgIds[1]]);

      const page2 = await service.conversationMessages(
        buyer.id,
        conv.id.toString(),
        { limit: 2, cursor: page1.nextCursor! },
      );
      expect(page2.items.map((m) => m.id)).toEqual([msgIds[0]]);
      expect(page2.hasMore).toBe(false);

      // 조회 부수효과로 읽음 처리 → 목록 안읽음 수 0
      const saved = await prisma.storeConversation.findUniqueOrThrow({
        where: { id: conv.id },
      });
      expect(saved.last_read_at).not.toBeNull();
      const list = await service.myConversations(buyer.id);
      expect(list.items[0].unreadCount).toBe(0);
    });

    it('남의 대화·없는 대화는 NotFoundException', async () => {
      const buyer = await setupBuyer();
      const other = await setupBuyer();
      const store = await createStore(prisma);
      const othersConv = await makeConversation({
        accountId: other.id,
        storeId: store.id,
      });

      await expect(
        service.conversationMessages(buyer.id, othersConv.id.toString()),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.conversationMessages(buyer.id, '999999'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
