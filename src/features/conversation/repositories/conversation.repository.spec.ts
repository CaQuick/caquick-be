import type { PrismaClient } from '@prisma/client';

import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('ConversationRepository (real DB)', () => {
  let repo: ConversationRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [ConversationRepository],
    });
    repo = module.get(ConversationRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function setupConversation() {
    const customer = await createAccount(prisma, { account_type: 'USER' });
    const store = await createStore(prisma);
    const conv = await prisma.storeConversation.create({
      data: { account_id: customer.id, store_id: store.id },
    });
    return { customer, store, conversation: conv };
  }

  describe('listConversationsByStore', () => {
    it('특정 store의 conversation만 반환한다', async () => {
      const a = await setupConversation();
      const b = await setupConversation();

      const rows = await repo.listConversationsByStore({
        storeId: a.store.id,
        limit: 10,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].store_id).toBe(a.store.id);
      expect(rows[0].id).not.toBe(b.conversation.id);
    });

    it('cursor보다 id가 작은 row만 반환 (내림차순 페이지네이션)', async () => {
      const customer = await createAccount(prisma, { account_type: 'USER' });
      const store = await createStore(prisma);
      const c1 = await prisma.storeConversation.create({
        data: { account_id: customer.id, store_id: store.id },
      });
      const customer2 = await createAccount(prisma, { account_type: 'USER' });
      const c2 = await prisma.storeConversation.create({
        data: { account_id: customer2.id, store_id: store.id },
      });

      const rows = await repo.listConversationsByStore({
        storeId: store.id,
        limit: 10,
        cursor: c2.id,
      });
      expect(rows.map((r) => r.id)).toEqual([c1.id]);
    });
  });

  describe('findConversationByIdAndStore', () => {
    it('conversationId + storeId가 모두 맞으면 반환', async () => {
      const { store, conversation } = await setupConversation();
      const found = await repo.findConversationByIdAndStore({
        conversationId: conversation.id,
        storeId: store.id,
      });
      expect(found?.id).toBe(conversation.id);
    });

    it('다른 store면 null', async () => {
      const { conversation } = await setupConversation();
      const otherStore = await createStore(prisma);
      const found = await repo.findConversationByIdAndStore({
        conversationId: conversation.id,
        storeId: otherStore.id,
      });
      expect(found).toBeNull();
    });
  });

  describe('listConversationMessages', () => {
    it('conversation의 메시지를 id 내림차순으로 반환', async () => {
      const { customer, conversation } = await setupConversation();
      const m1 = await prisma.storeConversationMessage.create({
        data: {
          conversation_id: conversation.id,
          sender_type: 'USER',
          sender_account_id: customer.id,
          body_format: 'TEXT',
          body_text: '첫번째',
        },
      });
      const m2 = await prisma.storeConversationMessage.create({
        data: {
          conversation_id: conversation.id,
          sender_type: 'USER',
          sender_account_id: customer.id,
          body_format: 'TEXT',
          body_text: '두번째',
        },
      });

      const rows = await repo.listConversationMessages({
        conversationId: conversation.id,
        limit: 10,
      });
      expect(rows.map((r) => r.id)).toEqual([m2.id, m1.id]);
    });
  });

  describe('createSellerConversationMessage', () => {
    it('메시지 생성 시 conversation.last_message_at/updated_at을 트랜잭션 안에서 갱신한다', async () => {
      const { store, conversation } = await setupConversation();
      const seller = await createAccount(prisma, { account_type: 'SELLER' });
      const now = new Date('2026-04-22T12:00:00Z');

      const message = await repo.createSellerConversationMessage({
        conversationId: conversation.id,
        sellerAccountId: seller.id,
        bodyFormat: 'TEXT',
        bodyText: '판매자 응답',
        bodyHtml: null,
        now,
      });

      expect(message.sender_type).toBe('STORE');
      expect(message.sender_account_id).toBe(seller.id);
      expect(message.body_text).toBe('판매자 응답');

      const updatedConv = await prisma.storeConversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      expect(updatedConv.last_message_at?.toISOString()).toBe(
        now.toISOString(),
      );
      expect(updatedConv.store_id).toBe(store.id);
    });
  });
});
