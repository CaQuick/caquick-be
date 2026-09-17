import { BadRequestException } from '@nestjs/common';

import type { S3Service } from '@/global/storage/s3.service';
import type { UploadPurpose } from '@/global/storage/types/storage.types';

/**
 * 저장하려는 이미지 URL이 이 계정·용도로 발급된 publicUrl인지 강제한다.
 * null은 "제거" 의미라 통과시킨다 — 호출부가 clean*Text로 정규화한 값을 넘긴다.
 */
export function assertOwnedUploadUrl(
  s3: S3Service,
  url: string | null,
  purpose: UploadPurpose,
  accountId: bigint,
  message: string,
): void {
  if (url === null) return;
  if (!s3.isOwnedUploadUrl(url, purpose, accountId)) {
    throw new BadRequestException(message);
  }
}
