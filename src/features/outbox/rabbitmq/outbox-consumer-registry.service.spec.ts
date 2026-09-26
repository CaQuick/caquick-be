import { Injectable } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { SubscribeOutbox } from '@/features/outbox/decorators/subscribe-outbox.decorator';
import { OutboxConsumerRegistry } from '@/features/outbox/rabbitmq/outbox-consumer-registry.service';
import type { OutboxConsumer } from '@/features/outbox/types/outbox-event.type';

@Injectable()
@SubscribeOutbox('test.a', 'test.b')
class GoodConsumer implements OutboxConsumer {
  handle(): Promise<void> {
    return Promise.resolve();
  }
}

@Injectable()
@SubscribeOutbox('test.c')
class BrokenConsumer {}

@Injectable()
class NotAConsumer {}

async function registryWith(
  providers: unknown[],
): Promise<OutboxConsumerRegistry> {
  const module = await Test.createTestingModule({
    imports: [DiscoveryModule],
    providers: [OutboxConsumerRegistry, ...(providers as never[])],
  }).compile();
  return module.get(OutboxConsumerRegistry);
}

describe('OutboxConsumerRegistry', () => {
  it('@SubscribeOutbox provider를 이름·이벤트·큐로 모은다(다른 provider는 제외), 두 번째부터는 캐시', async () => {
    const registry = await registryWith([GoodConsumer, NotAConsumer]);

    const consumers = registry.resolve();

    expect(consumers).toHaveLength(1);
    expect(consumers[0]).toMatchObject({
      name: 'GoodConsumer',
      eventTypes: ['test.a', 'test.b'],
      queues: {
        main: 'q.GoodConsumer',
        retry: 'q.GoodConsumer.retry',
        dlq: 'q.GoodConsumer.dlq',
      },
    });
    expect(registry.resolve()).toBe(consumers);
  });

  it('반증: handle이 없는 소비자는 던진다 — 재연결 루프 안에서 삼키면 브로커 부재처럼 보인다', async () => {
    const registry = await registryWith([GoodConsumer, BrokenConsumer]);
    expect(() => registry.resolve()).toThrow(
      'outbox 소비자 BrokenConsumer에 handle(event)가 없습니다',
    );
  });
});
