import { DomainException, type ErrorCode } from '@/common/errors/error-catalog';
import type { S3Service } from '@/global/storage/s3.service';
import type { UploadPurpose } from '@/global/storage/types/storage.types';
/** null은 "제거" 의미라 통과시킨다 — 호출부가 clean*Text로 정규화한 값을 넘긴다. */
export function assertOwnedUploadUrl(
  s3: S3Service,
  url: string | null,
  purpose: UploadPurpose,
  accountId: bigint,
  code: ErrorCode,
): void {
  if (url === null) return;
  if (!s3.isOwnedUploadUrl(url, purpose, accountId)) {
    throw new DomainException(code);
  }
}
