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
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        NotificationOutboxConsumer,
        NotificationRepository,
        // 대상 조회 repository가 발행 API를 주입받는다(08b)
        NotificationAdminRepository,
        ...outboxPublisherProviders(),
      ],
    });
    consumer = module.get(NotificationOutboxConsumer);
    prisma = p;
  });
  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  beforeEach(async () => {
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
