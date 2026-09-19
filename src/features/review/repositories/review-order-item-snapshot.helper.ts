import { Prisma } from '@/generated/prisma/client';
import { activeWhere } from '@/prisma';

/** 리뷰 카드의 주문 옵션 스냅샷 1행. review.option_summary JSON 배열 원소. */
export type ReviewOptionSummaryItem = {
  groupName: string;
  optionTitle: string;
};

export interface ReviewOrderItemSnapshot {
  product_name_snapshot: string;
  /** Json? 컬럼은 null 대신 Prisma.DbNull로 써야 한다 — 그대로 spread 가능한 형태 */
  option_summary: ReviewOptionSummaryItem[] | typeof Prisma.DbNull;
  before_image_url: string | null;
}

/**
 * 리뷰 작성 시점에 주문 품목에서 표시값을 복사한다(P1-07b) — 이후 조회는 review 컬럼만 읽는다.
 * 옵션은 활성 option_item을 id 순으로, before 이미지는 활성 free_edit 첫 장(sort_order·id 순). 옵션이 없으면 null.
 */
export async function snapshotReviewOrderItem(
  tx: Prisma.TransactionClient,
  orderItemId: bigint,
): Promise<ReviewOrderItemSnapshot> {
  const item = await tx.orderItem.findUniqueOrThrow({
    where: { id: orderItemId },
    select: {
      product_name_snapshot: true,
      option_items: {
        where: activeWhere,
        orderBy: { id: 'asc' },
        select: { group_name_snapshot: true, option_title_snapshot: true },
      },
      free_edits: {
        where: activeWhere,
        orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
        take: 1,
        select: { crop_image_url: true },
      },
    },
  });
  return {
    product_name_snapshot: item.product_name_snapshot,
    option_summary:
      item.option_items.length > 0
        ? item.option_items.map((o) => ({
            groupName: o.group_name_snapshot,
            optionTitle: o.option_title_snapshot,
          }))
        : Prisma.DbNull,
    before_image_url: item.free_edits[0]?.crop_image_url ?? null,
  };
}

/** JSON 컬럼을 방어적으로 읽는다 — 형태가 어긋난 값은 빈 목록(리뷰 자체는 보여준다). */
export function parseOptionSummary(
  value: Prisma.JsonValue | null | undefined,
): ReviewOptionSummaryItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    entry !== null &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    typeof entry.groupName === 'string' &&
    typeof entry.optionTitle === 'string'
      ? [{ groupName: entry.groupName, optionTitle: entry.optionTitle }]
      : [],
  );
}
