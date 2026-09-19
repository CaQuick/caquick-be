import type { Prisma } from '@/generated/prisma/client';

/** 발행 입력. payload는 생산 시점 스냅샷을 담는다(P1-9) — 소비자가 다른 도메인을 다시 읽지 않게. */
export interface OutboxEventInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Prisma.InputJsonValue;
  /** 기본값 clock.now(). 소비자는 이 값을 생성 시각(notification.created_at 등)으로 쓴다. */
  occurredAt?: Date;
  actorAccountId?: bigint | null;
}

/** 소비자에게 전달되는 이벤트. */
export interface OutboxEvent {
  id: bigint;
  eventId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Prisma.JsonValue;
  occurredAt: Date;
  actorAccountId: bigint | null;
  clientIp: string | null;
  userAgent: string | null;
  /** 이번 전달 이전의 시도 횟수 — 0이면 첫 전달 */
  attempts: number;
}

/** 소비자 계약. 전달은 at-least-once라 처리는 멱등해야 한다(source_event_id unique 등). */
export interface OutboxConsumer {
  handle(event: OutboxEvent): Promise<void>;
}

export interface DispatchSummary {
  published: number;
  retried: number;
  failed: number;
  /** 같은 파티션의 앞선 이벤트가 미처리라 이번 틱에서 미룬 수 */
  deferred: number;
}
