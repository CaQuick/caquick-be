import { Injectable } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';

import { OUTBOX_CONSUMER_EVENTS } from '@/features/outbox/constants/outbox.constants';
import {
  type ConsumerQueues,
  queuesFor,
} from '@/features/outbox/rabbitmq/topology';
import type { OutboxConsumer } from '@/features/outbox/types/outbox-event.type';

export interface RegisteredConsumer {
  name: string;
  eventTypes: string[];
  instance: OutboxConsumer;
  queues: ConsumerQueues;
}

/**
 * `@SubscribeOutbox` provider 목록 — 소비자 호스트(큐·소비)와 릴레이(토폴로지 선언)가 같은 목록을 본다.
 * 배선 오류(handle 없음)는 던진다 — 재연결 루프 안에서 삼키면 "브로커가 없는 것처럼" 무한 재시도가 된다.
 */
@Injectable()
export class OutboxConsumerRegistry {
  private cached: RegisteredConsumer[] | undefined;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  resolve(): RegisteredConsumer[] {
    if (this.cached) return this.cached;
    const found: RegisteredConsumer[] = [];
    for (const wrapper of this.discovery.getProviders()) {
      if (!wrapper.metatype || !wrapper.instance) continue;
      const eventTypes = this.reflector.get<string[] | undefined>(
        OUTBOX_CONSUMER_EVENTS,
        wrapper.metatype,
      );
      if (!eventTypes?.length) continue;
      const instance: unknown = wrapper.instance;
      if (
        typeof instance !== 'object' ||
        instance === null ||
        typeof (instance as OutboxConsumer).handle !== 'function'
      ) {
        throw new Error(
          `outbox 소비자 ${wrapper.name}에 handle(event)가 없습니다`,
        );
      }
      const name = String(wrapper.name);
      found.push({
        name,
        eventTypes,
        instance: instance as OutboxConsumer,
        queues: queuesFor(name),
      });
    }
    this.cached = found;
    return found;
  }
}
