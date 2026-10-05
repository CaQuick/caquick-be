/** 실 Redis(testcontainers) 발행/구독 왕복 — JSON 직렬화를 거친 payload가 구독자에게 그대로 도착하는지 확인한다(DB 불필요). */
import { RedisPubSub } from 'graphql-redis-subscriptions';
import type { PubSubEngine } from 'graphql-subscriptions';
import Redis from 'ioredis';
import type { StartedTestContainer } from 'testcontainers';

import { ConversationEventsService } from '@/features/conversation/services/conversation-events.service';
import type { ConversationMessageOutput } from '@/features/conversation/types/conversation-output.type';
import { redisTestContainer } from '@/test/containers';

jest.setTimeout(180_000);

describe('ConversationEventsService (real Redis)', () => {
  let container: StartedTestContainer;
  let publisher: Redis;
  let pubSub: RedisPubSub;
  let service: ConversationEventsService;

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
    service = new ConversationEventsService(pubSub);
  });

  afterAll(async () => {
    await pubSub.close();
    await container.stop();
  });

  async function nextEvent(iterator: AsyncIterator<unknown>) {
    return (await iterator.next()).value;
  }

  /**
   * asyncIterableIterator는 첫 next() 호출 시점에 Redis SUBSCRIBE를 보낸다 —
   * 발행 전에 next()를 먼저 걸고 서버에 구독이 잡힐 때까지(PUBSUB NUMSUB) 기다려야 이벤트를
   * 놓치지 않는다(구독 등록 전 발행분은 유실되는 게 Pub/Sub 의미론). 고정 대기는 부하에서 모자란다.
   */
  async function startListening(
    iterator: AsyncIterator<unknown>,
    channel: string,
  ) {
    const pending = nextEvent(iterator);
    for (;;) {
      const [, count] = (await publisher.pubsub('NUMSUB', channel)) as [
        string,
        number,
      ];
      if (count > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // Promise를 그대로 반환하면 호출부의 await가 이벤트 도착까지 평탄화해
    // 기다려 버린다 — 객체로 감싸 구독 시작만 보장하고 대기는 호출부 몫으로.
    return { pending };
  }

  it('대화방 메시지 발행이 해당 대화 구독자에게만 도착한다', async () => {
    const target = service.messageAddedIterator('10');
    const other = service.messageAddedIterator('99');
    const { pending: pendingTarget } = await startListening(
      target,
      'conversation.message.10',
    );
    const otherReceived = jest.fn();
    const { pending: pendingOther } = await startListening(
      other,
      'conversation.message.99',
    );
    void pendingOther.then(otherReceived);

    const message: ConversationMessageOutput = {
      id: '1',
      conversationId: '10',
      senderType: 'USER',
      bodyFormat: 'TEXT',
      bodyText: '픽업 문의',
      bodyHtml: null,
      createdAt: new Date('2026-08-01T12:00:00Z'),
    };
    await service.publishMessagesAdded([message]);

    // Redis JSON 왕복 후에도 이벤트 payload가 보존된다(날짜는 ISO 문자열)
    await expect(pendingTarget).resolves.toEqual({
      id: '1',
      conversationId: '10',
      senderType: 'USER',
      bodyFormat: 'TEXT',
      bodyText: '픽업 문의',
      bodyHtml: null,
      createdAt: '2026-08-01T12:00:00.000Z',
    });
    expect(otherReceived).not.toHaveBeenCalled();
    await other.return?.();
  });

  it('구매자/판매자 목록 갱신 이벤트가 각 토픽으로 도착한다', async () => {
    const buyer = service.buyerListIterator('7');
    const seller = service.sellerListIterator('3');
    const { pending: pendingBuyer } = await startListening(
      buyer,
      'conversation.buyer.7',
    );
    const { pending: pendingSeller } = await startListening(
      seller,
      'conversation.seller.3',
    );

    await service.publishBuyerListUpdate('7', {
      conversationId: '10',
      storeId: '3',
      storeName: '해즈 케이크',
      lastMessagePreview: '답변 드리겠습니다',
      lastMessageAt: '2026-08-01T12:00:00.000Z',
      lastReadAt: null,
      unreadCount: 2,
    });
    await service.publishSellerListUpdate('3', {
      conversationId: '10',
      accountId: '7',
      buyerNickname: '현진',
      lastMessagePreview: '픽업 문의',
      lastMessageAt: '2026-08-01T12:00:00.000Z',
      sellerLastReadAt: null,
      unreadCount: 1,
    });

    await expect(pendingBuyer).resolves.toMatchObject({
      storeName: '해즈 케이크',
      unreadCount: 2,
    });
    await expect(pendingSeller).resolves.toMatchObject({
      accountId: '7',
      lastMessagePreview: '픽업 문의',
    });
  });

  it('발행 실패는 삼킨다 — 커밋된 전송을 Redis 장애가 실패로 만들지 않는다', async () => {
    const failing = {
      publish: jest.fn().mockRejectedValue(new Error('redis down')),
    } as unknown as PubSubEngine;
    const failingService = new ConversationEventsService(failing);

    await expect(
      failingService.publishBuyerListUpdate('1', {
        conversationId: '1',
        storeId: '2',
        storeName: '매장',
        lastMessagePreview: null,
        lastMessageAt: '2026-08-01T12:00:00.000Z',
        lastReadAt: null,
        unreadCount: 0,
      }),
    ).resolves.toBeUndefined();
    await expect(
      failingService.publishMessagesAdded([
        {
          id: '1',
          conversationId: '1',
          senderType: 'USER',
          bodyFormat: 'TEXT',
          bodyText: '문의',
          bodyHtml: null,
          createdAt: new Date(),
        },
      ]),
    ).resolves.toBeUndefined();
  });
});
