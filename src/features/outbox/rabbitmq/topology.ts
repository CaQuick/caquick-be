import type { ConfirmChannel } from 'amqplib';

import type { OutboxRow } from '@/features/outbox/repositories/outbox.repository';
import type { OutboxEvent } from '@/features/outbox/types/outbox-event.type';
import type { Prisma } from '@/generated/prisma/client';

/** 도메인 이벤트 exchange(topic). routing key = event_type. durable — 브로커 재시작에도 남는다. */
export const EVENTS_EXCHANGE = 'caquick.events';
/** 만료된 retry 메시지가 본 큐로 돌아오는 경로. 큐마다 own routing key로 바인딩한다. */
export const RETRY_EXCHANGE = 'caquick.events.retry';
/**
 * 재시도 상한을 넘긴 메시지. outbox 행은 이미 PUBLISHED라 `outbox:requeue`(FAILED 대상)로는 못 살린다 —
 * `yarn outbox:requeue --event-id=<uuid> --republish`로 행을 PENDING으로 되돌려 릴레이가 다시 싣는다(소비자 멱등 계약).
 * 관리 UI에서 shovel하면 x-caquick-attempts 헤더가 남아 재시도 없이 다시 DLQ로 간다 — 헤더를 지우고 옮겨야 한다.
 */
export const DLQ_EXCHANGE = 'caquick.events.dlq';

/** 메시지 헤더 — 소비 재시도 횟수. outbox.attempts(발행 재시도)와는 다른 축이다. */
export const ATTEMPTS_HEADER = 'x-caquick-attempts';

export interface ConsumerQueues {
  /** 소비자가 읽는 큐 */
  main: string;
  /** 지연 뒤 본 큐로 돌아가는 큐(per-message TTL) */
  retry: string;
  /** 상한 초과 */
  dlq: string;
}

/** 소비자 클래스 이름에서 큐 이름을 만든다 — 클래스 하나 = 큐 하나, 이름이 바뀌면 큐도 새로 생긴다(옛 큐는 수동 정리). */
export function queuesFor(consumerName: string): ConsumerQueues {
  const base = `q.${consumerName}`;
  return { main: base, retry: `${base}.retry`, dlq: `${base}.dlq` };
}

export interface ConsumerTopology {
  queues: ConsumerQueues;
  eventTypes: readonly string[];
}

/**
 * exchange 3개 + 소비자마다 큐 3개(본·retry·dlq)와 바인딩. 릴레이와 소비자 호스트가 **같이** 부른다 —
 * 릴레이만 exchange를 만들고 발행하면 소비자가 아직 큐를 못 만든 순간의 메시지는 라우팅될 곳이 없어 버려진다
 * (브로커는 unroutable에도 confirm을 준다). 선언은 멱등(assert)이라 누가 먼저 붙어도 같은 결과다.
 */
export async function assertTopology(
  channel: ConfirmChannel,
  consumers: readonly ConsumerTopology[],
): Promise<void> {
  await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
  await channel.assertExchange(RETRY_EXCHANGE, 'direct', { durable: true });
  await channel.assertExchange(DLQ_EXCHANGE, 'direct', { durable: true });
  for (const { queues, eventTypes } of consumers) {
    await channel.assertQueue(queues.main, { durable: true });
    for (const eventType of eventTypes) {
      await channel.bindQueue(queues.main, EVENTS_EXCHANGE, eventType);
    }
    // retry: 만료되면 RETRY_EXCHANGE를 거쳐 본 큐로 돌아온다(routing key = 본 큐 이름)
    await channel.assertQueue(queues.retry, {
      durable: true,
      deadLetterExchange: RETRY_EXCHANGE,
      deadLetterRoutingKey: queues.main,
    });
    await channel.bindQueue(queues.main, RETRY_EXCHANGE, queues.main);
    await channel.assertQueue(queues.dlq, { durable: true });
    await channel.bindQueue(queues.dlq, DLQ_EXCHANGE, queues.dlq);
  }
}

/** 브로커가 이 코드로 거절한 선언은 재시도해도 풀리지 않는다(큐 인자 불일치 406, 권한 403). */
export function isPermanentBrokerError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 406 || code === 403;
}

/** 브로커로 나가는 메시지 본문 — OutboxEvent와 같은 필드, bigint·Date는 문자열. */
export interface OutboxMessage {
  id: string;
  eventId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Prisma.JsonValue;
  occurredAt: string;
  actorAccountId: string | null;
  clientIp: string | null;
  userAgent: string | null;
}

export function toMessage(row: OutboxRow): OutboxMessage {
  return {
    id: row.id.toString(),
    eventId: row.event_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    payload: row.payload_json,
    occurredAt: row.occurred_at.toISOString(),
    actorAccountId: row.actor_account_id?.toString() ?? null,
    clientIp: row.client_ip,
    userAgent: row.user_agent,
  };
}

/** 소비자 계약(OutboxEvent)으로 되돌린다. attempts는 소비 재시도 횟수(헤더)다. */
export function toEvent(message: OutboxMessage, attempts: number): OutboxEvent {
  return {
    id: BigInt(message.id),
    eventId: message.eventId,
    aggregateType: message.aggregateType,
    aggregateId: message.aggregateId,
    eventType: message.eventType,
    payload: message.payload,
    occurredAt: new Date(message.occurredAt),
    actorAccountId:
      message.actorAccountId === null ? null : BigInt(message.actorAccountId),
    clientIp: message.clientIp,
    userAgent: message.userAgent,
    attempts,
  };
}

/** 깨진 본문은 던진다 — 소비자가 잘못된 payload를 "정상 소비"로 삼키지 않게 DLQ로 보낸다. */
export function parseMessage(body: Buffer): OutboxMessage {
  const value: unknown = JSON.parse(body.toString('utf8'));
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as OutboxMessage).eventId !== 'string' ||
    typeof (value as OutboxMessage).eventType !== 'string' ||
    typeof (value as OutboxMessage).id !== 'string'
  ) {
    throw new Error('outbox 메시지 형식이 아닙니다');
  }
  return value as OutboxMessage;
}
