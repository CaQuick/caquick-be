import type { OutboxEventInput } from '@/features/outbox';
import type { Prisma } from '@/generated/prisma/client';

/** 리뷰 최초 좋아요 이벤트(복원 좋아요는 발행하지 않는다 — 알림 스팸 방지). payload는 생산 시점 스냅샷(P1-9). */
export const REVIEW_LIKED = 'review.liked';

export interface ReviewLikedPayload {
  reviewId: string;
  authorAccountId: string;
  likerAccountId: string;
  storeId: string;
  storeName: string | null;
  productId: string;
  productName: string | null;
}

export function reviewLikedEvent(args: {
  reviewId: bigint;
  authorAccountId: bigint;
  likerAccountId: bigint;
  storeId: bigint;
  storeName: string | null;
  productId: bigint;
  productName: string | null;
}): OutboxEventInput {
  const payload: ReviewLikedPayload = {
    reviewId: args.reviewId.toString(),
    authorAccountId: args.authorAccountId.toString(),
    likerAccountId: args.likerAccountId.toString(),
    storeId: args.storeId.toString(),
    storeName: args.storeName,
    productId: args.productId.toString(),
    productName: args.productName,
  };
  return {
    aggregateType: 'review',
    aggregateId: payload.reviewId,
    eventType: REVIEW_LIKED,
    payload: { ...payload },
    actorAccountId: args.likerAccountId,
  };
}

/** 소비자용 방어적 파싱 — 형태가 어긋난 payload는 던져서 재시도·FAILED로 드러낸다. */
export function parseReviewLikedPayload(
  value: Prisma.JsonValue,
): ReviewLikedPayload {
  const p = value as Partial<Record<keyof ReviewLikedPayload, unknown>>;
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    typeof p.reviewId !== 'string' ||
    typeof p.authorAccountId !== 'string' ||
    typeof p.likerAccountId !== 'string' ||
    typeof p.storeId !== 'string' ||
    typeof p.productId !== 'string'
  ) {
    throw new Error(`${REVIEW_LIKED} payload 형식 오류`);
  }
  return {
    reviewId: p.reviewId,
    authorAccountId: p.authorAccountId,
    likerAccountId: p.likerAccountId,
    storeId: p.storeId,
    storeName: typeof p.storeName === 'string' ? p.storeName : null,
    productId: p.productId,
    productName: typeof p.productName === 'string' ? p.productName : null,
  };
}
