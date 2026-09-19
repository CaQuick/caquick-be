/** nested relation은 soft-delete 자동 필터 밖이라 삭제된 행은 없는 것으로 본다. */
export function activeOrNull<T extends { deleted_at: Date | null }>(
  row: T | null | undefined,
): T | null {
  return row && row.deleted_at === null ? row : null;
}
