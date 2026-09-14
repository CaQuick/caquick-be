import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import {
  ACCOUNT_NOT_ACTIVE,
  ACCOUNT_NOT_FOUND,
  ADMIN_ONLY,
} from '@/features/admin/constants/admin-error-messages';
import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import type { IAuditLogRepository } from '@/features/audit-log';
import { AccountType } from '@/generated/prisma/client';

export interface AdminContext {
  accountId: bigint;
}

/**
 * 관리자 서비스 공통 베이스. RolesGuard가 1차로 막고, 여기서 DB 기준으로 한 번 더 확인한다
 * (판매자의 requireSellerContext와 대칭 — 토큰 발급 후 타입·상태가 바뀐 계정을 걸러 낸다).
 */
export abstract class AdminBaseService {
  protected constructor(
    protected readonly repo: AdminRepository,
    protected readonly auditLogs: IAuditLogRepository,
  ) {}

  protected async requireAdminContext(
    accountId: bigint,
  ): Promise<AdminContext> {
    const account = await this.repo.findAdminAccountContext(accountId);
    if (!account) throw new UnauthorizedException(ACCOUNT_NOT_FOUND);
    if (account.account_type !== AccountType.ADMIN) {
      throw new ForbiddenException(ADMIN_ONLY);
    }
    if (account.status !== 'ACTIVE') {
      throw new ForbiddenException(ACCOUNT_NOT_ACTIVE);
    }
    return { accountId: account.id };
  }
}
