import type { PrismaClient, Tag } from '@prisma/client';

import { nextSeq } from '@/test/factories/sequence';

export async function createTag(
  prisma: PrismaClient,
  overrides: { name?: string; deleted_at?: Date | null } = {},
): Promise<Tag> {
  const seq = nextSeq();
  return prisma.tag.create({
    data: {
      name: overrides.name ?? `tag_${seq}`,
      deleted_at: overrides.deleted_at ?? null,
    },
  });
}

/** 상품 ↔ 태그 연결. */
export async function linkProductTag(
  prisma: PrismaClient,
  args: { productId: bigint; tagId: bigint; deleted_at?: Date | null },
): Promise<void> {
  await prisma.productTag.create({
    data: {
      product_id: args.productId,
      tag_id: args.tagId,
      deleted_at: args.deleted_at ?? null,
    },
  });
}
