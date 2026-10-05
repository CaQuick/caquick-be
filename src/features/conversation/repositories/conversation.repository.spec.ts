import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { ConversationRepository } from '@/features/conversation/repositories/conversation.repository';
import { AuditActionType, AuditTargetType } from '@/generated/prisma/client';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

/** repository가 조작과 같은 트랜잭션에 남기는 감사 항목 — 내용 자체는 서비스 spec이 본다. */
const AUDIT_ENTRY = {
  actorAccountId: 1n,
  storeId: null,
  targetType: AuditTargetType.CONVERSATION,
  targetId: 1n,
  action: AuditActionType.UPDATE,
};

describe('ConversationRepository (real DB)', () => {
  let repo: ConversationRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        ConversationRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
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

  async function setupConversation(
    overrides: {
      storeId?: bigint;
      sellerLastReadAt?: Date | null;
      lastMessageAt?: Date | null;
      updatedAt?: Date;
      deletedAt?: Date | null;
    } = {},
  ) {
    const customer = await createAccount(prisma, { account_type: 'USER' });
    const store = overrides.storeId
      ? await prisma.store.findUniqueOrThrow({
          where: { id: overrides.storeId },
        })
      : await createStore(prisma);
    const conv = await prisma.storeConversation.create({
      data: {
        account_id: customer.id,
        store_id: store.id,
        seller_last_read_at: overrides.sellerLastReadAt ?? null,
        last_message_at: overrides.lastMessageAt ?? null,
        updated_at: overrides.updatedAt,
        deleted_at: overrides.deletedAt ?? null,
      },
    });
    return { customer, store, conversation: conv };
  }

  function hoursAgo(hours: number): Date {
    return new Date(Date.now() - hours * 60 * 60 * 1000);
  }

  async function addMessage(args: {
    conversationId: bigint;
    senderType?: 'USER' | 'STORE' | 'SYSTEM';
    bodyFormat?: 'TEXT' | 'HTML';
    bodyText?: string | null;
    bodyHtml?: string | null;
    createdAt?: Date;
    deletedAt?: Date | null;
  }) {
    return prisma.storeConversationMessage.create({
      data: {
        conversation_id: args.conversationId,
        sender_type: args.senderType ?? 'USER',
        body_format: args.bodyFormat ?? 'TEXT',
        body_text: args.bodyText === undefined ? '메시지' : args.bodyText,
        body_html: args.bodyHtml ?? null,
        created_at: args.createdAt ?? new Date(),
        deleted_at: args.deletedAt ?? null,
      },
    });
  }

  async function conversationRow(id: bigint) {
    return prisma.storeConversation.findUniqueOrThrow({ where: { id } });
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

      const message = await repo.createSellerConversationMessage(
        {
          conversationId: conversation.id,
          sellerAccountId: seller.id,
          bodyFormat: 'TEXT',
          bodyText: '판매자 응답',
          bodyHtml: null,
        },
        () => AUDIT_ENTRY,
      );

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

    it('답장은 seller_last_read_at을 메시지 시각으로 전진시킨다(답장 = 읽음)', async () => {
      const { conversation } = await setupConversation({
        sellerLastReadAt: hoursAgo(3),
      });
      const seller = await createAccount(prisma, { account_type: 'SELLER' });
      await addMessage({
        conversationId: conversation.id,
        createdAt: hoursAgo(1),
      });

      const message = await repo.createSellerConversationMessage(
        {
          conversationId: conversation.id,
          sellerAccountId: seller.id,
          bodyFormat: 'TEXT',
          bodyText: '답장',
          bodyHtml: null,
        },
        () => AUDIT_ENTRY,
      );

      const row = await conversationRow(conversation.id);
      expect(row.seller_last_read_at?.getTime()).toBe(
        message.created_at.getTime(),
      );
      expect(await repo.countUnansweredConversationsByStore(row.store_id)).toBe(
        0,
      );
    });

    it('판매자 마커만 미래 시각이어도 새 메시지는 그보다 뒤 시각을 받는다(GREATEST 항 반증)', async () => {
      const futureMarker = new Date(Date.now() + 60 * 60 * 1000);
      const { conversation } = await setupConversation({
        sellerLastReadAt: futureMarker,
      });
      const seller = await createAccount(prisma, { account_type: 'SELLER' });

      const message = await repo.createSellerConversationMessage(
        {
          conversationId: conversation.id,
          sellerAccountId: seller.id,
          bodyFormat: 'TEXT',
          bodyText: '컷오버 이후 답장',
          bodyHtml: null,
        },
        () => AUDIT_ENTRY,
      );

      expect(message.created_at.getTime()).toBeGreaterThan(
        futureMarker.getTime(),
      );
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

      const message = await repo.createSellerConversationMessage(
        {
          conversationId: conversation.id,
          sellerAccountId: seller.id,
          bodyFormat: 'TEXT',
          bodyText: '컷오버 이후 답장',
          bodyHtml: null,
        },
        () => AUDIT_ENTRY,
      );

      // created_at > last_read_at 이어야 안읽음 판정에서 누락되지 않는다
      expect(message.created_at.getTime()).toBeGreaterThan(
        futureMarker.getTime(),
      );
    });
  });

  describe('markSellerRead', () => {
    it('최신 메시지의 created_at까지 전진하고 미읽음 0·미리보기를 돌려준다', async () => {
      const { conversation } = await setupConversation();
      await addMessage({
        conversationId: conversation.id,
        createdAt: hoursAgo(2),
      });
      const newest = await addMessage({
        conversationId: conversation.id,
        bodyFormat: 'HTML',
        bodyText: null,
        bodyHtml: '<p>최신 <b>문의</b></p>',
        createdAt: hoursAgo(1),
      });

      const result = await repo.markSellerRead(conversation.id);

      expect(result?.conversation.seller_last_read_at?.getTime()).toBe(
        newest.created_at.getTime(),
      );
      expect(result?.extra?.unreadCount).toBe(0);
      expect(result?.extra?.lastMessage?.body_html).toBe(
        '<p>최신 <b>문의</b></p>',
      );
      const row = await conversationRow(conversation.id);
      expect(row.seller_last_read_at?.getTime()).toBe(
        newest.created_at.getTime(),
      );
    });

    it('메시지가 없으면 마커를 바꾸지 않고 현재 상태를 돌려준다', async () => {
      const { conversation } = await setupConversation();

      const result = await repo.markSellerRead(conversation.id);

      expect(result?.conversation.seller_last_read_at).toBeNull();
      expect(result?.extra?.unreadCount).toBe(0);
      expect(result?.extra?.lastMessage).toBeNull();
    });

    it('반복 호출해도 같은 값이다(멱등)', async () => {
      const { conversation } = await setupConversation();
      await addMessage({
        conversationId: conversation.id,
        createdAt: hoursAgo(1),
      });

      const first = await repo.markSellerRead(conversation.id);
      const second = await repo.markSellerRead(conversation.id);

      expect(second?.conversation.seller_last_read_at?.getTime()).toBe(
        first?.conversation.seller_last_read_at?.getTime(),
      );
    });

    it('마커가 최신 메시지보다 뒤면 후퇴하지 않는다', async () => {
      const marker = hoursAgo(1);
      const { conversation } = await setupConversation({
        sellerLastReadAt: marker,
      });
      await addMessage({
        conversationId: conversation.id,
        createdAt: hoursAgo(2),
      });

      await repo.markSellerRead(conversation.id);

      const row = await conversationRow(conversation.id);
      expect(row.seller_last_read_at?.getTime()).toBe(marker.getTime());
    });

    it('읽음은 updated_at을 바꾸지 않는다(목록 정렬 보존)', async () => {
      const updatedAt = new Date('2026-09-01T00:00:00.000Z');
      const { conversation } = await setupConversation({ updatedAt });
      await addMessage({
        conversationId: conversation.id,
        createdAt: hoursAgo(1),
      });

      const result = await repo.markSellerRead(conversation.id);

      expect(result?.conversation.seller_last_read_at).not.toBeNull();
      const row = await conversationRow(conversation.id);
      expect(row.updated_at.getTime()).toBe(updatedAt.getTime());
    });

    it('soft-delete된 대화는 갱신하지 않고 null을 돌려준다', async () => {
      const { conversation } = await setupConversation({
        deletedAt: new Date(),
      });
      await addMessage({
        conversationId: conversation.id,
        createdAt: hoursAgo(1),
      });

      expect(await repo.markSellerRead(conversation.id)).toBeNull();

      const row = await conversationRow(conversation.id);
      expect(row.seller_last_read_at).toBeNull();
    });

    it('미커밋 전송이 잠금을 쥐고 있으면 커밋을 기다린 뒤 그 메시지까지 전진한다', async () => {
      const { conversation } = await setupConversation();
      await addMessage({
        conversationId: conversation.id,
        createdAt: hoursAgo(2),
      });
      const inFlightAt = hoursAgo(1);

      let lockHeld!: () => void;
      let release!: () => void;
      const held = new Promise<void>((r) => (lockHeld = r));
      const released = new Promise<void>((r) => (release = r));
      // 전송 경로 재현: 대화 잠금 → 메시지 삽입 → (커밋 보류)
      const sender = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM store_conversation WHERE id = ${conversation.id} FOR UPDATE`;
          await tx.storeConversationMessage.create({
            data: {
              conversation_id: conversation.id,
              sender_type: 'USER',
              body_format: 'TEXT',
              body_text: '아직 커밋 전',
              created_at: inFlightAt,
            },
          });
          lockHeld();
          await released;
        },
        { timeout: 10_000 },
      );
      await held;

      const marking = repo.markSellerRead(conversation.id);
      // 잠금 대기 중임을 확인한 뒤 커밋 — 잠금 없이 조회했다면 이 시점에 이미 옛 메시지로 전진했다
      await new Promise((r) => setTimeout(r, 300));
      expect(
        (await conversationRow(conversation.id)).seller_last_read_at,
      ).toBeNull();
      release();
      await sender;

      const result = await marking;
      expect(result?.conversation.seller_last_read_at?.getTime()).toBe(
        inFlightAt.getTime(),
      );
    });
  });

  describe('listBuyerMessagesAndMarkRead', () => {
    it('구매자 읽음은 updated_at을 바꾸지 않는다(판매자 목록 정렬 보존)', async () => {
      const updatedAt = new Date('2026-09-01T00:00:00.000Z');
      const { conversation } = await setupConversation({ updatedAt });
      await addMessage({
        conversationId: conversation.id,
        senderType: 'STORE',
        createdAt: hoursAgo(1),
      });

      await repo.listBuyerMessagesAndMarkRead({
        conversationId: conversation.id,
        limit: 10,
      });

      const row = await conversationRow(conversation.id);
      expect(row.last_read_at).not.toBeNull();
      expect(row.updated_at.getTime()).toBe(updatedAt.getTime());
    });
  });

  describe('getStoreConversationPageWithExtras', () => {
    it('미리보기(HTML 태그 제거)와 판매자 기준 미읽음(USER만)을 함께 돌려준다', async () => {
      const store = await createStore(prisma);
      const { conversation: unread } = await setupConversation({
        storeId: store.id,
        sellerLastReadAt: hoursAgo(5),
      });
      // 마커 이전 USER 1건(안 셈) + 이후 USER 2건·STORE 1건·SYSTEM 1건(USER만 셈)
      await addMessage({ conversationId: unread.id, createdAt: hoursAgo(6) });
      await addMessage({ conversationId: unread.id, createdAt: hoursAgo(4) });
      await addMessage({ conversationId: unread.id, createdAt: hoursAgo(3) });
      await addMessage({
        conversationId: unread.id,
        senderType: 'STORE',
        createdAt: hoursAgo(2),
      });
      await addMessage({
        conversationId: unread.id,
        senderType: 'SYSTEM',
        bodyFormat: 'HTML',
        bodyText: null,
        bodyHtml: '<p>시스템 <b>안내</b></p>',
        createdAt: hoursAgo(1),
      });
      const { conversation: never } = await setupConversation({
        storeId: store.id,
      });
      await addMessage({ conversationId: never.id, createdAt: hoursAgo(1) });
      await addMessage({ conversationId: never.id, createdAt: hoursAgo(1) });

      const { rows, totalCount, extras } =
        await repo.getStoreConversationPageWithExtras({
          storeId: store.id,
          limit: 10,
        });

      expect(totalCount).toBe(2);
      expect(rows).toHaveLength(2);
      const byId = new Map(extras.map((e) => [e.conversationId, e]));
      expect(byId.get(unread.id)).toMatchObject({
        unreadCount: 2,
        lastMessage: { body_html: '<p>시스템 <b>안내</b></p>' },
      });
      // 마커 null이면 USER 전부
      expect(byId.get(never.id)?.unreadCount).toBe(2);
    });

    it('hasMore 판정용 초과분(limit+1)의 부가 정보는 조회하지 않는다', async () => {
      const store = await createStore(prisma);
      for (let i = 0; i < 3; i++) {
        const { conversation } = await setupConversation({ storeId: store.id });
        await addMessage({ conversationId: conversation.id });
      }

      const { rows, extras } = await repo.getStoreConversationPageWithExtras({
        storeId: store.id,
        limit: 2,
      });

      expect(rows).toHaveLength(3);
      expect(extras.map((e) => e.conversationId)).toEqual(
        rows.slice(0, 2).map((r) => r.id),
      );
    });
  });

  describe('countUnansweredConversationsByStore', () => {
    type Case = {
      name: string;
      expected: number;
      arrange: (storeId: bigint) => Promise<void>;
    };
    const cases: Case[] = [
      {
        name: '마커 null + USER 메시지 1건',
        expected: 1,
        arrange: async (storeId) => {
          const { conversation } = await setupConversation({
            storeId,
            lastMessageAt: hoursAgo(1),
          });
          await addMessage({
            conversationId: conversation.id,
            createdAt: hoursAgo(1),
          });
        },
      },
      {
        name: '마커가 last_message_at 이상',
        expected: 0,
        arrange: async (storeId) => {
          const { conversation } = await setupConversation({
            storeId,
            lastMessageAt: hoursAgo(1),
            sellerLastReadAt: hoursAgo(1),
          });
          await addMessage({
            conversationId: conversation.id,
            createdAt: hoursAgo(1),
          });
        },
      },
      {
        name: 'USER 뒤 판매자 답장만(답장이 마커를 전진)',
        expected: 0,
        arrange: async (storeId) => {
          const { conversation } = await setupConversation({ storeId });
          await addMessage({
            conversationId: conversation.id,
            createdAt: hoursAgo(1),
          });
          const seller = await createAccount(prisma, {
            account_type: 'SELLER',
          });
          await repo.createSellerConversationMessage(
            {
              conversationId: conversation.id,
              sellerAccountId: seller.id,
              bodyFormat: 'TEXT',
              bodyText: '답장',
              bodyHtml: null,
            },
            () => AUDIT_ENTRY,
          );
        },
      },
      {
        // 마지막 발신자 기준이면 STORE가 마지막이라 빠진다 — 미읽음 기준이라 센다
        name: 'USER 질문 + STORE 자동응답이 같은 시각, 마커 이전',
        expected: 1,
        arrange: async (storeId) => {
          const at = hoursAgo(1);
          const { conversation } = await setupConversation({
            storeId,
            lastMessageAt: at,
            sellerLastReadAt: hoursAgo(5),
          });
          await addMessage({ conversationId: conversation.id, createdAt: at });
          await addMessage({
            conversationId: conversation.id,
            senderType: 'STORE',
            createdAt: at,
          });
        },
      },
      {
        name: 'soft-delete된 대화',
        expected: 0,
        arrange: async (storeId) => {
          const { conversation } = await setupConversation({
            storeId,
            lastMessageAt: hoursAgo(1),
            deletedAt: new Date(),
          });
          await addMessage({
            conversationId: conversation.id,
            createdAt: hoursAgo(1),
          });
        },
      },
      {
        name: 'soft-delete된 USER 메시지만',
        expected: 0,
        arrange: async (storeId) => {
          const { conversation } = await setupConversation({
            storeId,
            lastMessageAt: hoursAgo(1),
          });
          await addMessage({
            conversationId: conversation.id,
            createdAt: hoursAgo(1),
            deletedAt: new Date(),
          });
        },
      },
      {
        name: '다른 매장의 미읽음 대화',
        expected: 0,
        arrange: async () => {
          const { conversation } = await setupConversation({
            lastMessageAt: hoursAgo(1),
          });
          await addMessage({
            conversationId: conversation.id,
            createdAt: hoursAgo(1),
          });
        },
      },
    ];

    it.each(cases)('$name → $expected', async ({ arrange, expected }) => {
      const store = await createStore(prisma);
      await arrange(store.id);
      expect(await repo.countUnansweredConversationsByStore(store.id)).toBe(
        expected,
      );
    });
  });

  describe('createBuyerMessages 닉네임 스냅샷', () => {
    const entry = {
      senderType: 'USER' as const,
      senderAccountId: null,
      bodyFormat: 'TEXT' as const,
      bodyText: '문의',
      bodyHtml: null,
    };

    it('새 대화에는 호출 시점 닉네임을 저장한다', async () => {
      const customer = await createAccount(prisma, { account_type: 'USER' });
      const store = await createStore(prisma);

      const { conversationId } = await repo.createBuyerMessages({
        accountId: customer.id,
        storeId: store.id,
        buyerNickname: '현진',
        greetingBodyText: '안녕하세요',
        entries: [entry],
      });

      expect(
        (await conversationRow(conversationId)).buyer_nickname_snapshot,
      ).toBe('현진');
    });

    it('기존 대화(soft-delete 재사용 포함)의 스냅샷은 바꾸지 않는다', async () => {
      const customer = await createAccount(prisma, { account_type: 'USER' });
      const store = await createStore(prisma);
      const existing = await prisma.storeConversation.create({
        data: {
          account_id: customer.id,
          store_id: store.id,
          buyer_nickname_snapshot: '옛닉네임',
          deleted_at: new Date(),
        },
      });

      const { conversationId } = await repo.createBuyerMessages({
        accountId: customer.id,
        storeId: store.id,
        buyerNickname: '새닉네임',
        greetingBodyText: '안녕하세요',
        entries: [entry],
      });

      expect(conversationId).toBe(existing.id);
      expect((await conversationRow(existing.id)).buyer_nickname_snapshot).toBe(
        '옛닉네임',
      );
    });
  });
});
