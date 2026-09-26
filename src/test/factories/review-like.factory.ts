import type { PrismaClient, ReviewLike } from '@/generated/prisma/client';
import { createAccount } from '@/test/factories/account.factory';

export interface ReviewLikeOverrides {
  review_id: bigint;
  /** 생략하면 새 USER 계정을 만들어 누른다(리뷰당 계정 1개 유니크). */
  account_id?: bigint;
  deleted_at?: Date | null;
}

export async function createReviewLike(
  prisma: PrismaClient,
  overrides: ReviewLikeOverrides,
): Promise<ReviewLike> {
  const accountId =
    overrides.account_id ??
    (await createAccount(prisma, { account_type: 'USER' })).id;
  return prisma.reviewLike.create({
    data: {
      review_id: overrides.review_id,
      account_id: accountId,
      deleted_at: overrides.deleted_at ?? null,
    },
  });
}
