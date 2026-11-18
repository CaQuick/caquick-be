import type { OutboxEventInput } from '@/features/outbox';
import type { Prisma } from '@/generated/prisma/client';

/** 주간 정산 생성(매장별). 관리자 '정산 송금' 알림의 원천이다. */
export const SETTLEMENT_CREATED = 'settlement.created';

export interface SettlementCreatedPayload {
  settlementId: string;
  storeId: string;
  storeName: string;
  /** 정산 기간(KST 월~일), YYYY-MM-DD */
  periodStart: string;
  periodEnd: string;
  orderCount: number;
  settlementBaseAmount: number;
  commissionAmount: number;
  payoutAmount: number;
}

export function settlementCreatedEvent(
  payload: SettlementCreatedPayload,
  occurredAt: Date,
): OutboxEventInput {
  return {
    aggregateType: 'settlement',
    aggregateId: payload.settlementId,
    eventType: SETTLEMENT_CREATED,
    payload: { ...payload },
    occurredAt,
    actorAccountId: null,
  };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_KEYS = [
  'orderCount',
  'settlementBaseAmount',
  'commissionAmount',
  'payoutAmount',
] as const;

export function parseSettlementCreatedPayload(
  value: Prisma.JsonValue,
): SettlementCreatedPayload {
  const p = value as Partial<Record<keyof SettlementCreatedPayload, unknown>>;
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    typeof p.settlementId !== 'string' ||
    typeof p.storeId !== 'string' ||
    typeof p.storeName !== 'string' ||
    typeof p.periodStart !== 'string' ||
    !DATE_ONLY.test(p.periodStart) ||
    typeof p.periodEnd !== 'string' ||
    !DATE_ONLY.test(p.periodEnd) ||
    AMOUNT_KEYS.some((key) => !Number.isSafeInteger(p[key]))
  ) {
    throw new Error(`${SETTLEMENT_CREATED} payload 형식 오류`);
  }
  return {
    settlementId: p.settlementId,
    storeId: p.storeId,
    storeName: p.storeName,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    orderCount: p.orderCount as number,
    settlementBaseAmount: p.settlementBaseAmount as number,
    commissionAmount: p.commissionAmount as number,
    payoutAmount: p.payoutAmount as number,
  };
}
