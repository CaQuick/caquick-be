import type {
  PrismaClient,
  ReviewMedia,
  ReviewMediaType,
} from '@/generated/prisma/client';

export interface ReviewMediaOverrides {
  review_id: bigint;
  media_type?: ReviewMediaType;
  media_url?: string;
  thumbnail_url?: string | null;
  sort_order?: number;
  deleted_at?: Date | null;
}

export async function createReviewMedia(
  prisma: PrismaClient,
  overrides: ReviewMediaOverrides,
): Promise<ReviewMedia> {
  return prisma.reviewMedia.create({
    data: {
      review_id: overrides.review_id,
      media_type: overrides.media_type ?? 'IMAGE',
      media_url: overrides.media_url ?? 'a.png',
      thumbnail_url: overrides.thumbnail_url ?? null,
      sort_order: overrides.sort_order ?? 0,
      deleted_at: overrides.deleted_at ?? null,
    },
  });
}
