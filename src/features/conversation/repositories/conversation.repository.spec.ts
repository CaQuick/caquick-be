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

    it('커서 이후 페이지만 반환한다 ((updated_at, id) desc 키셋)', async () => {
      const store = await createStore(prisma);
      const make = async (updatedAt: Date) => {
        const customer = await createAccount(prisma, { account_type: 'USER' });
        return prisma.storeConversation.create({
          data: {
            account_id: customer.id,
            store_id: store.id,
            updated_at: updatedAt,
          },
        });
      };
      const newer = await make(new Date('2026-09-03T00:00:00Z'));
      const older = await make(new Date('2026-09-01T00:00:00Z'));

      const rows = await repo.listConversationsByStore({
        storeId: store.id,
        limit: 10,
        cursor: { updatedAt: newer.updated_at, id: newer.id },
      });
      expect(rows.map((r) => r.id)).toEqual([older.id]);
    });

    it('updated_at이 같으면 id 내림차순으로 이어서 끊는다', async () => {
      // 커서의 보조 키 분기(updated_at 동률 → id < cursor.id)를 타는 케이스.
      // 서로 다른 updated_at만 쓰면 이 분기가 한 번도 실행되지 않는다.
      const store = await createStore(prisma);
      const sameTime = new Date('2026-09-05T00:00:00Z');
      const make = async () => {
        const customer = await createAccount(prisma, { account_type: 'USER' });
        return prisma.storeConversation.create({
          data: {
            account_id: customer.id,
            store_id: store.id,
            updated_at: sameTime,
          },
        });
      };
      const first = await make();
      const second = await make();
      expect(second.id > first.id).toBe(true);

      const rows = await repo.listConversationsByStore({
        storeId: store.id,
        limit: 10,
        cursor: { updatedAt: sameTime, id: second.id },
      });
      expect(rows.map((r) => r.id)).toEqual([first.id]);
    });

    it('id가 더 큰 오래된 대화도 커서 페이지에서 빠지지 않는다', async () => {
      // 정렬은 updated_at desc인데 커서가 id 단독이면 `id < cursor`가 정렬과
      // 무관한 행을 잘라내, id가 큰 오래된 대화가 목록에서 영영 빠졌다.
      const store = await createStore(prisma);
      const make = async (updatedAt: Date) => {
        const customer = await createAccount(prisma, { account_type: 'USER' });
        return prisma.storeConversation.create({
          data: {
            account_id: customer.id,
            store_id: store.id,
            updated_at: updatedAt,
          },
        });
      };
      // 나중에 만들어 id가 크지만 updated_at은 가장 오래된 대화
      const first = await make(new Date('2026-09-03T00:00:00Z'));
      const second = await make(new Date('2026-09-02T00:00:00Z'));
      const lastById = await make(new Date('2026-09-01T00:00:00Z'));
      expect(lastById.id > first.id).toBe(true);

      const page1 = await repo.listConversationsByStore({
        storeId: store.id,
        limit: 2,
      });
      expect(page1.map((r) => r.id)).toEqual([
        first.id,
        second.id,
        lastById.id,
      ]);

      const cursorRow = page1[1];
      const page2 = await repo.listConversationsByStore({
        storeId: store.id,
        limit: 2,
        cursor: { updatedAt: cursorRow.updated_at, id: cursorRow.id },
      });
      expect(page2.map((r) => r.id)).toEqual([lastById.id]);
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

      const message = await repo.createSellerConversationMessage({
        conversationId: conversation.id,
        sellerAccountId: seller.id,
        bodyFormat: 'TEXT',
        bodyText: '판매자 응답',
        bodyHtml: null,
      });

      expect(message.sender_type).toBe('STORE');
      expect(message.sender_account_id).toBe(seller.id);
      expect(message.body_text).toBe('판매자 응답');

      const updatedConv = await prisma.storeConversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      // 시각은 대화 잠금 아래에서 repository가 채번한다 — 메시지와 동일해야 함
      expect(updatedConv.last_message_at?.getTime()).toBe(
        message.created_at.getTime(),
      );
      expect(updatedConv.store_id).toBe(store.id);
    });

    it('기존 마커가 미래 시각이어도 새 메시지는 그보다 뒤 시각을 받는다(시계 컷오버 보정)', async () => {
      const { conversation } = await setupConversation();
      const seller = await createAccount(prisma, { account_type: 'SELLER' });
      // 앱 시계가 앞섰던 노드가 남긴 미래 마커 재현
      const futureMarker = new Date(Date.now() + 60 * 60 * 1000);
      await prisma.storeConversation.update({
        where: { id: conversation.id },
        data: { last_read_at: futureMarker, last_message_at: futureMarker },
      });

      const message = await repo.createSellerConversationMessage({
        conversationId: conversation.id,
        sellerAccountId: seller.id,
        bodyFormat: 'TEXT',
        bodyText: '컷오버 이후 답장',
        bodyHtml: null,
      });

      // created_at > last_read_at 이어야 안읽음 판정에서 누락되지 않는다
      expect(message.created_at.getTime()).toBeGreaterThan(
        futureMarker.getTime(),
      );
    });
  });
});
