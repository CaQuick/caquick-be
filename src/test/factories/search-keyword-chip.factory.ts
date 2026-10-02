import type {
  PrismaClient,
  SearchKeywordChip,
} from '@/generated/prisma/client';
import { nextSeq } from '@/test/factories/sequence';

/** 삭제된 칩은 active_key를 비운다(서비스의 삭제 경로와 같은 상태). */
export async function createSearchKeywordChip(
  prisma: PrismaClient,
  overrides: {
    keyword?: string;
    sort_order?: number;
    is_active?: boolean;
    starts_at?: Date | null;
    ends_at?: Date | null;
    deleted_at?: Date | null;
  } = {},
): Promise<SearchKeywordChip> {
  const keyword = overrides.keyword ?? `chip_${nextSeq()}`;
  const deletedAt = overrides.deleted_at ?? null;
  return prisma.searchKeywordChip.create({
    data: {
      keyword,
      active_key: deletedAt ? null : keyword,
      sort_order: overrides.sort_order ?? 0,
      is_active: overrides.is_active ?? true,
      starts_at: overrides.starts_at ?? null,
      ends_at: overrides.ends_at ?? null,
      deleted_at: deletedAt,
    },
  });
}
