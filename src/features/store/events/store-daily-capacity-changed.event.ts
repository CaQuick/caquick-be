import type { OutboxEventInput } from '@/features/outbox';
import type { Prisma } from '@/generated/prisma/client';

/**
 * 매장 일일 capacity 설정 변경. order가 소유 복제본 `order_store_daily_limit`을 갱신한다.
 * capacity null = 설정 삭제. updatedAt은 원본 row의 updated_at — 소비자가 뒤늦게 온 오래된 이벤트를 무시하는 기준.
 */
export const STORE_DAILY_CAPACITY_CHANGED = 'store.daily_capacity_changed';

export interface StoreDailyCapacityChangedPayload {
  storeId: string;
  /** 'YYYY-MM-DD' (UTC date 부분 — store_daily_capacity.capacity_date와 같은 표현) */
  capacityDate: string;
  capacity: number | null;
  /** ISO 8601 */
  updatedAt: string;
}

export function storeDailyCapacityChangedEvent(args: {
  storeId: bigint;
  capacityDate: Date;
  capacity: number | null;
  updatedAt: Date;
  actorAccountId: bigint | null;
}): OutboxEventInput {
  const payload: StoreDailyCapacityChangedPayload = {
    storeId: args.storeId.toString(),
    capacityDate: args.capacityDate.toISOString().slice(0, 10),
    capacity: args.capacity,
    updatedAt: args.updatedAt.toISOString(),
  };
  return {
    aggregateType: 'store',
    aggregateId: payload.storeId,
    eventType: STORE_DAILY_CAPACITY_CHANGED,
    payload: { ...payload },
    occurredAt: args.updatedAt,
    actorAccountId: args.actorAccountId,
  };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** 소비자용 방어적 파싱 — 형태가 어긋난 payload는 던져서 재시도·FAILED로 드러낸다. */
export function parseStoreDailyCapacityChangedPayload(
  value: Prisma.JsonValue,
): StoreDailyCapacityChangedPayload {
  const p = value as Partial<
    Record<keyof StoreDailyCapacityChangedPayload, unknown>
  >;
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    typeof p.storeId !== 'string' ||
    typeof p.capacityDate !== 'string' ||
    !DATE_ONLY.test(p.capacityDate) ||
    !(p.capacity === null || Number.isSafeInteger(p.capacity)) ||
    typeof p.updatedAt !== 'string' ||
    Number.isNaN(Date.parse(p.updatedAt))
  ) {
    throw new Error(`${STORE_DAILY_CAPACITY_CHANGED} payload 형식 오류`);
  }
  return {
    storeId: p.storeId,
    capacityDate: p.capacityDate,
    capacity: p.capacity as number | null,
    updatedAt: p.updatedAt,
  };
}
