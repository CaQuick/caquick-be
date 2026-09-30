import { ClockService } from '@/common/providers/clock.service';
import { NotificationAdminRepository } from '@/features/notification/repositories/notification-admin.repository';
import { NotificationRepository } from '@/features/notification/repositories/notification.repository';
import { NotificationOutboxConsumer } from '@/features/notification/services/notification-outbox.consumer';
import type { OutboxEvent } from '@/features/outbox';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createReview,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';

const OCCURRED_AT = new Date('2026-09-19T12:00:00.000Z');

function event(
  eventType: string,
  payload: OutboxEvent['payload'],
  eventId = '11111111-1111-4111-8111-111111111111',
): OutboxEvent {
  return {
    id: 1n,
    eventId,
    aggregateType: 'test',
    aggregateId: '1',
    eventType,
    payload,
    occurredAt: OCCURRED_AT,
    actorAccountId: null,
    clientIp: null,
    userAgent: null,
    attempts: 0,
  };
}

// 알림 생성의 단일 진입점 — payload 스냅샷 → 알림 컬럼 매핑, SUBMITTED 무시, 재전달 멱등, 형식 오류는 던진다.
describe('NotificationOutboxConsumer (real DB)', () => {
  let consumer: NotificationOutboxConsumer;
  let repo: NotificationRepository;
  let prisma: PrismaClient;
  let now = OCCURRED_AT;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        NotificationOutboxConsumer,
        NotificationRepository,
        // 대상 조회 repository가 발행 API를 주입받는다(08b)
        NotificationAdminRepository,
        ...outboxPublisherProviders({ clock: true }),
        { provide: ClockService, useValue: { now: () => now } },
      ],
    });
    consumer = module.get(NotificationOutboxConsumer);
    repo = module.get(NotificationRepository);
    prisma = p;
  });
  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  beforeEach(async () => {
    now = OCCURRED_AT;
    await truncateAll();
  });

  describe('order.status_changed', () => {
    it('payload 스냅샷으로 구매자 알림을 만들고 created_at은 이벤트 발생 시각이다', async () => {
      const buyer = await createAccount(prisma, { account_type: 'USER' });
      const order = await createOrder(prisma, { account_id: buyer.id });
      const item = await createOrderItem(prisma, { order_id: order.id });
      await consumer.handle(
        event('order.status_changed', {
          orderId: order.id.toString(),
          orderNumber: 'ORD-77',
          buyerAccountId: buyer.id.toString(),
          fromStatus: 'SUBMITTED',
          toStatus: 'CONFIRMED',
          storeId: item.store_id.toString(),
          storeName: '케이크샵',
          productId: item.product_id.toString(),
          productName: '레터링 케이크',
        }),
      );

      const [row] = await prisma.notification.findMany();
      expect(row).toMatchObject({
        account_id: buyer.id,
        type: 'ORDER_STATUS',
        event: 'ORDER_CONFIRMED',
        order_id: order.id,
        store_id: item.store_id,
        product_id: item.product_id,
        order_number: 'ORD-77',
        store_name: '케이크샵',
        product_name: '레터링 케이크',
        source_event_id: '11111111-1111-4111-8111-111111111111',
        created_at: OCCURRED_AT,
      });
      expect(row.body).toContain('ORD-77');
    });

    it('SUBMITTED 전이는 알림 없이 정상 소비되고, 같은 이벤트 재전달은 중복을 만들지 않는다', async () => {
      const buyer = await createAccount(prisma, { account_type: 'USER' });
      const order = await createOrder(prisma, { account_id: buyer.id });
      const submitted = event('order.status_changed', {
        orderId: order.id.toString(),
        orderNumber: 'ORD-1',
        buyerAccountId: buyer.id.toString(),
        fromStatus: 'SUBMITTED',
        toStatus: 'SUBMITTED',
        storeId: null,
        storeName: null,
        productId: null,
        productName: null,
      });
      await consumer.handle(submitted);
      expect(await prisma.notification.count()).toBe(0);

      const canceled = event('order.status_changed', {
        ...(submitted.payload as object),
        toStatus: 'CANCELED',
      });
      await consumer.handle(canceled);
      await consumer.handle(canceled);
      expect(await prisma.notification.count()).toBe(1);
    });
  });

  it('review.liked는 작성자에게 좋아요 알림을 만든다', async () => {
    const review = await createReview(prisma);
    await consumer.handle(
      event('review.liked', {
        reviewId: review.id.toString(),
        authorAccountId: review.account_id.toString(),
        likerAccountId: '4',
        storeId: review.store_id.toString(),
        storeName: null,
        productId: review.product_id.toString(),
        productName: '상품',
      }),
    );
    expect(await prisma.notification.findFirst()).toMatchObject({
      account_id: review.account_id,
      type: 'REVIEW_LIKE',
      event: 'REVIEW_LIKED',
      review_id: review.id,
      store_name: null,
      product_name: '상품',
    });
  });

  describe('notification.broadcast_requested', () => {
    async function bulkUsers(count: number, prefix = 'bulk'): Promise<void> {
      await prisma.account.createMany({
        data: Array.from({ length: count }, (_, i) => ({
          account_type: 'USER' as const,
          status: 'ACTIVE' as const,
          email: `${prefix}${i}@example.com`,
        })),
      });
    }

    const EVENT_ID = '11111111-1111-4111-8111-111111111111';

    /** 발송 요청 tx가 남기는 이력 행(완료 전 상태). */
    async function broadcastRow(targetCount: number): Promise<void> {
      await prisma.notificationBroadcast.create({
        data: {
          event_id: EVENT_ID,
          actor_account_id: 1n,
          type: 'SYSTEM',
          title: '공지',
          body: '본문',
          target_kind: 'ACCOUNT_IDS',
          target_count: targetCount,
          skipped_count: 0,
          skipped_account_ids: [],
          created_at: OCCURRED_AT,
        },
      });
    }
    function accountIdsEvent(ids: bigint[]): OutboxEvent {
      return event('notification.broadcast_requested', {
        type: 'SYSTEM',
        title: '공지',
        body: '본문',
        audience: { kind: 'ACCOUNT_IDS', accountIds: ids.map(String) },
        skippedAccountIds: [],
      });
    }
    function allUsersEvent(maxAccountId: bigint, count: number): OutboxEvent {
      return event('notification.broadcast_requested', {
        type: 'SYSTEM',
        title: '공지',
        body: '본문',
        audience: {
          kind: 'ALL_USERS',
          maxAccountId: maxAccountId.toString(),
          count,
        },
        skippedAccountIds: [],
      });
    }
    async function history() {
      return prisma.notificationBroadcast.findUniqueOrThrow({
        where: { event_id: EVENT_ID },
      });
    }

    describe('발송 이력 완료 기록', () => {
      it('ACCOUNT_IDS는 청크를 전부 넣은 뒤 완료 시각과 실제 저장 수를 기록한다', async () => {
        await bulkUsers(1_005);
        const ids = (
          await prisma.account.findMany({ select: { id: true } })
        ).map((a) => a.id);
        await broadcastRow(1_005);
        now = new Date(OCCURRED_AT.getTime() + 7_000);

        await consumer.handle(accountIdsEvent(ids));

        expect(await history()).toMatchObject({
          delivered_count: 1_005,
          completed_at: now,
        });
      });

      it('ALL_USERS는 키셋 페이지를 끝까지 훑은 뒤 완료를 기록한다', async () => {
        await bulkUsers(1_000);
        const cutoff = (await prisma.account.aggregate({ _max: { id: true } }))
          ._max.id!;
        await broadcastRow(1_000);

        await consumer.handle(allUsersEvent(cutoff, 1_000));

        expect(await history()).toMatchObject({
          delivered_count: 1_000,
          completed_at: OCCURRED_AT,
        });
      });

      it.each([
        ['ALL_USERS 대상 0명', () => allUsersEvent(0n, 0)],
        ['ACCOUNT_IDS 전원 비활성', () => accountIdsEvent([999_999n])],
      ])('%s이면 저장 없이 즉시 완료한다', async (_label, build) => {
        await broadcastRow(0);

        await consumer.handle(build());

        expect(await prisma.notification.count()).toBe(0);
        expect(await history()).toMatchObject({
          delivered_count: 0,
          completed_at: OCCURRED_AT,
        });
      });

      it('재전달은 저장 수를 다시 세고 첫 완료 시각은 유지한다(멱등)', async () => {
        const user = await createAccount(prisma, { account_type: 'USER' });
        await broadcastRow(1);
        await consumer.handle(accountIdsEvent([user.id]));

        now = new Date(OCCURRED_AT.getTime() + 60_000);
        await consumer.handle(accountIdsEvent([user.id]));

        expect(await prisma.notification.count()).toBe(1);
        expect(await history()).toMatchObject({
          delivered_count: 1,
          completed_at: OCCURRED_AT,
        });
      });

      it('요청 뒤 정지된 계정은 저장되지 않아 저장 수가 대상 수보다 적다', async () => {
        const [stays, suspended] = await Promise.all([
          createAccount(prisma, { account_type: 'USER' }),
          createAccount(prisma, { account_type: 'USER' }),
        ]);
        await broadcastRow(2);
        await prisma.account.update({
          where: { id: suspended.id },
          data: { status: 'SUSPENDED' },
        });

        await consumer.handle(accountIdsEvent([stays.id, suspended.id]));

        expect(await history()).toMatchObject({
          target_count: 2,
          delivered_count: 1,
        });
      });

      it('반증: 청크 저장이 중간에 실패하면 완료를 기록하지 않는다', async () => {
        await bulkUsers(1_005);
        const ids = (
          await prisma.account.findMany({ select: { id: true } })
        ).map((a) => a.id);
        await broadcastRow(1_005);
        const original = repo.createFromEvent.bind(repo);
        const spy = jest
          .spyOn(repo, 'createFromEvent')
          .mockImplementationOnce(original)
          .mockRejectedValueOnce(new Error('db down'));

        await expect(consumer.handle(accountIdsEvent(ids))).rejects.toThrow(
          'db down',
        );
        spy.mockRestore();

        expect(await prisma.notification.count()).toBe(1_000);
        expect(await history()).toMatchObject({
          delivered_count: null,
          completed_at: null,
        });
      });

      it('이력 행이 없는 요청(이력 도입 전)도 알림은 저장하고 던지지 않는다', async () => {
        const user = await createAccount(prisma, { account_type: 'USER' });

        await expect(
          consumer.handle(accountIdsEvent([user.id])),
        ).resolves.toBeUndefined();

        expect(await prisma.notification.count()).toBe(1);
        expect(await prisma.notificationBroadcast.count()).toBe(0);
      });
    });

    it('ACCOUNT_IDS 목록은 청크 단위로 만들고 재전달에도 한 번씩만 남는다', async () => {
      await bulkUsers(1_005);
      const ids = (await prisma.account.findMany({ select: { id: true } })).map(
        (a) => a.id.toString(),
      );
      const broadcast = event('notification.broadcast_requested', {
        type: 'MARKETING',
        title: '이벤트',
        body: '본문',
        audience: { kind: 'ACCOUNT_IDS', accountIds: ids },
        skippedAccountIds: [],
      });

      await consumer.handle(broadcast);
      await consumer.handle(broadcast);

      expect(
        await prisma.notification.count({
          where: { type: 'MARKETING', event: null, title: '이벤트' },
        }),
      ).toBe(1_005);
    });

    it('ACCOUNT_IDS도 발송 시점 활성 USER만 저장한다 — 요청 뒤 정지된 계정은 제외', async () => {
      const [stays, suspended] = await Promise.all([
        prisma.account.create({
          data: { account_type: 'USER', status: 'ACTIVE', email: 'a@x.com' },
        }),
        prisma.account.create({
          data: { account_type: 'USER', status: 'ACTIVE', email: 'b@x.com' },
        }),
      ]);
      // 요청 시점엔 둘 다 활성 → payload에 둘 다 들어간 상태에서 한 명이 정지된다
      await prisma.account.update({
        where: { id: suspended.id },
        data: { status: 'SUSPENDED' },
      });

      await consumer.handle(
        event('notification.broadcast_requested', {
          type: 'SYSTEM',
          title: '공지',
          body: '본문',
          audience: {
            kind: 'ACCOUNT_IDS',
            accountIds: [stays.id.toString(), suspended.id.toString()],
          },
          skippedAccountIds: [],
        }),
      );

      expect(
        (await prisma.notification.findMany()).map((n) => n.account_id),
      ).toEqual([stays.id]);
    });

    it('ALL_USERS는 요청 시점 컷오프(maxAccountId) 이하 활성 USER만 페이지로 훑고, 컷오프 뒤 가입자·비활성는 제외한다', async () => {
      await bulkUsers(1_002);
      const cutoff = (await prisma.account.aggregate({ _max: { id: true } }))
        ._max.id!;
      await prisma.account.create({
        data: { account_type: 'USER', status: 'SUSPENDED', email: 's@x.com' },
      });
      await bulkUsers(3, 'late');

      await consumer.handle(
        event('notification.broadcast_requested', {
          type: 'SYSTEM',
          title: '공지',
          body: '본문',
          audience: {
            kind: 'ALL_USERS',
            maxAccountId: cutoff.toString(),
            count: 1_002,
          },
          skippedAccountIds: [],
        }),
      );

      expect(await prisma.notification.count()).toBe(1_002);
      expect(
        await prisma.notification.count({
          where: { account_id: { gt: cutoff } },
        }),
      ).toBe(0);
    });
  });

  it.each([
    ['order.status_changed', { orderId: 1 }],
    [
      'order.status_changed',
      {
        orderId: '1',
        orderNumber: 'x',
        buyerAccountId: '1',
        fromStatus: 'NOPE',
        toStatus: 'CONFIRMED',
      },
    ],
    ['review.liked', { reviewId: '1' }],
    [
      'notification.broadcast_requested',
      {
        type: 'SPAM',
        title: 't',
        body: 'b',
        audience: { kind: 'ACCOUNT_IDS', accountIds: [] },
        skippedAccountIds: [],
      },
    ],
    [
      'notification.broadcast_requested',
      {
        type: 'SYSTEM',
        title: 't',
        body: 'b',
        audience: { kind: 'ACCOUNT_IDS', accountIds: [1] },
        skippedAccountIds: [],
      },
    ],
    [
      'notification.broadcast_requested',
      {
        type: 'SYSTEM',
        title: 't',
        body: 'b',
        audience: { kind: 'ALL_USERS', maxAccountId: 5, count: 1 },
        skippedAccountIds: [],
      },
    ],
  ])(
    '반증: %s의 형식이 어긋난 payload는 던진다(재시도·FAILED로 드러난다)',
    async (type, payload) => {
      await expect(
        consumer.handle(event(type, payload as OutboxEvent['payload'])),
      ).rejects.toThrow('payload 형식 오류');
      expect(await prisma.notification.count()).toBe(0);
    },
  );

  it('반증: 존재하지 않는 주문을 가리키는 이벤트는 조용히 0건이 되지 않고 FK 오류로 던진다', async () => {
    const buyer = await createAccount(prisma, { account_type: 'USER' });
    await expect(
      consumer.handle(
        event('order.status_changed', {
          orderId: '999999',
          orderNumber: 'ORD-X',
          buyerAccountId: buyer.id.toString(),
          fromStatus: 'SUBMITTED',
          toStatus: 'CONFIRMED',
          storeId: null,
          storeName: null,
          productId: null,
          productName: null,
        }),
      ),
    ).rejects.toThrow();
    expect(await prisma.notification.count()).toBe(0);
  });

  it('반증: 구독하지 않은 event_type은 던진다', async () => {
    await expect(consumer.handle(event('other.event', {}))).rejects.toThrow(
      '구독하지 않은',
    );
  });
});
