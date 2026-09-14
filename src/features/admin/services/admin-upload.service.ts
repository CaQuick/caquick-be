import { Injectable } from '@nestjs/common';

import type { AdminCreateUploadUrlInput } from '@/features/admin/dto/inputs/admin-create-upload-url.input';
import { S3Service } from '@/global/storage/s3.service';
import type { CreateUploadUrlOutput } from '@/global/storage/types/storage.types';

/**
 * 관리자 이미지 업로드 Presigned URL 발급.
 *
 * 발급 용도는 DTO의 화이트리스트가 좁히고, 저장 시 소유권 검증(assertOwnedUploadUrl)이
 * 같은 용도·같은 계정으로 발급된 URL인지 대조한다. 두 단계가 한 쌍이다.
 */
@Injectable()
export class AdminUploadService {
  constructor(private readonly s3Service: S3Service) {}

  adminCreateUploadUrl(
    accountId: bigint,
    input: AdminCreateUploadUrlInput,
  ): Promise<CreateUploadUrlOutput> {
    return this.s3Service.createUploadUrl({
      accountId,
      purpose: input.purpose,
      contentType: input.contentType,
      contentLength: input.contentLength,
    });
  }
}
