import type { SearchKeywordChipRow } from '@/features/search/repositories/search-admin.repository';
import type { AdminSearchKeywordChipOutput } from '@/features/search/types/search-admin-output.type';

export function toAdminSearchKeywordChipOutput(
  row: SearchKeywordChipRow,
): AdminSearchKeywordChipOutput {
  return {
    id: row.id.toString(),
    keyword: row.keyword,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
