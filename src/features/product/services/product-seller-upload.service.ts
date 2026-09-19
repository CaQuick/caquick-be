import { Inject, Injectable } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import type { SellerCreateUploadUrlInput } from '@/features/product/dto/inputs/seller-create-upload-url.input';
import { SellerBaseService, StoreSellerRepository } from '@/features/store';
import { S3Service } from '@/global/storage/s3.service';
import type { CreateUploadUrlOutput } from '@/global/storage/types/storage.types';

@Injectable()
export class SellerUploadService extends SellerBaseService {
  constructor(
    repo: StoreSellerRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly s3: S3Service,
  ) {
    super(repo, auditLogs);
  }

  // 발급은 DB 상태를 바꾸지 않으므로 감사 로그 대상이 아니다.
  async sellerCreateUploadUrl(
    accountId: bigint,
    input: SellerCreateUploadUrlInput,
  ): Promise<CreateUploadUrlOutput> {
    const ctx = await this.requireSellerContext(accountId);
    return this.s3.createUploadUrl({
      accountId: ctx.accountId,
      purpose: input.purpose,
      contentType: input.contentType,
      contentLength: input.contentLength,
    });
  }
}
