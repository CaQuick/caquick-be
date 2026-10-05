/** 실 Redis(testcontainers) 발행/구독 왕복 — JSON 직렬화를 거친 payload가 구독자에게 그대로 도착하는지 확인한다(DB 불필요). */
import { RedisPubSub } from 'graphql-redis-subscriptions';
import type { PubSubEngine } from 'graphql-subscriptions';
import Redis from 'ioredis';
import type { StartedTestContainer } from 'testcontainers';

import { OrderEventsService } from '@/features/order/services/order-events.service';
import type { SellerOrderUpdateEvent } from '@/features/order/types/order-seller-output.type';
import { redisTestContainer } from '@/test/containers';

jest.setTimeout(180_000);

const EVENT: SellerOrderUpdateEvent = {
  orderId: '1',
  orderNumber: 'ORD-20260916-ABC234',
  status: 'SUBMITTED',
  pickupAt: '2026-09-18T05:00:00.000Z',
  buyerName: '차차',
  totalPrice: 56000,
  productName: '딸기 케이크',
  updatedAt: '2026-09-16T07:00:00.000Z',
};

describe('OrderEventsService (real Redis)', () => {
  let container: StartedTestContainer;
  let publisher: Redis;
  let pubSub: RedisPubSub;
  let service: OrderEventsService;

  beforeAll(async () => {
    container = await redisTestContainer().start();
    const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
    publisher = new Redis(url);
    const subscriber = new Redis(url);
    // 준비 확인(INFO)이 끝나기 전에 SUBSCRIBE가 나가면 구독 모드에서 INFO가 거절된다 — 둘 다 ready를 기다린다
    await Promise.all(
      [publisher, subscriber].map(
        (client) => new Promise((resolve) => client.once('ready', resolve)),
      ),
    );
    pubSub = new RedisPubSub({ publisher, subscriber });
    service = new OrderEventsService(pubSub);
  });

  afterAll(async () => {
    await pubSub.close();
    await container.stop();
  });

  /**
   * asyncIterableIterator는 첫 next() 호출 시점에 Redis SUBSCRIBE를 보낸다 —
   * 발행 전에 next()를 먼저 걸고 서버에 구독이 잡힐 때까지(PUBSUB NUMSUB) 기다려야 이벤트를
   * 놓치지 않는다(구독 등록 전 발행분은 유실되는 게 Pub/Sub 의미론).
   */
  async function startListening(
    iterator: AsyncIterator<unknown>,
    channel: string,
  ) {
    const pending = iterator.next().then((r) => r.value);
    for (;;) {
      const [, count] = (await publisher.pubsub('NUMSUB', channel)) as [
        string,
        number,
      ];
      if (count > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { pending };
  }

  it('판매자 토픽 발행이 해당 매장 구독자에게만 도착하고 ISO 날짜가 보존된다', async () => {
    const target = service.sellerOrderIterator(BigInt(3));
    const other = service.sellerOrderIterator(BigInt(99));
    const { pending: pendingTarget } = await startListening(
      target,
      'order.seller.3',
    );
    const otherReceived = jest.fn();
    const { pending: pendingOther } = await startListening(
      other,
      'order.seller.99',
    );
    void pendingOther.then(otherReceived);

    await service.publishSellerOrderUpdate(BigInt(3), EVENT);

    await expect(pendingTarget).resolves.toEqual(EVENT);
    expect(otherReceived).not.toHaveBeenCalled();
    await other.return?.();
  });

  it('발행 실패는 삼킨다 — 커밋된 주문을 Redis 장애가 실패로 만들지 않는다', async () => {
    const failing = {
      publish: jest.fn().mockRejectedValue(new Error('redis down')),
    } as unknown as PubSubEngine;

    await expect(
      new OrderEventsService(failing).publishSellerOrderUpdate(
        BigInt(1),
        EVENT,
      ),
    ).resolves.toBeUndefined();
  });
});
