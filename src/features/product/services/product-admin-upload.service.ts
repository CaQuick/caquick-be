import { Inject, Injectable } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { AccountAdminRepository, AdminBaseService } from '@/features/auth';
import type { AdminCreateUploadUrlInput } from '@/features/product/dto/inputs/admin-create-upload-url.input';
import { S3Service } from '@/global/storage/s3.service';
import type { CreateUploadUrlOutput } from '@/global/storage/types/storage.types';

@Injectable()
export class AdminUploadService extends AdminBaseService {
  constructor(
    accounts: AccountAdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly s3: S3Service,
  ) {
    super(accounts, auditLogs);
  }

  // 발급은 DB 상태를 바꾸지 않으므로 감사 로그 대상이 아니다.
  async adminCreateUploadUrl(
    accountId: bigint,
    input: AdminCreateUploadUrlInput,
  ): Promise<CreateUploadUrlOutput> {
    const ctx = await this.requireAdminContext(accountId);
    return this.s3.createUploadUrl({
      accountId: ctx.accountId,
      purpose: input.purpose,
      contentType: input.contentType,
      contentLength: input.contentLength,
    });
  }
}
