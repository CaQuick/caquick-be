import { DomainException } from '@/common/errors/error-catalog';
import { formatAccountLabel } from '@/common/utils/account-label';
import { activeOrNull } from '@/common/utils/active-or-null';
import type { IAuditLogRepository } from '@/features/audit-log';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { AccountType } from '@/generated/prisma/client';
export interface AdminContext {
  accountId: bigint;
  /** 처리자·발송자 스냅샷에 남기는 계정 라벨(formatAccountLabel). 이름·아이디가 둘 다 없으면 null. */
  displayLabel: string | null;
}

/** RolesGuard가 1차로 막고, 여기서 DB 기준으로 한 번 더 확인한다 — 토큰 발급 후 타입·상태가 바뀐 계정을 걸러 낸다. */
export abstract class AdminBaseService {
  protected constructor(
    protected readonly accounts: AccountAdminRepository,
    protected readonly auditLogs: IAuditLogRepository,
  ) {}

  protected async requireAdminContext(
    accountId: bigint,
  ): Promise<AdminContext> {
    const account = await this.accounts.findAdminAccountContext(accountId);
    if (!account) throw new DomainException('SESSION_ACCOUNT_MISSING');
    if (account.account_type !== AccountType.ADMIN) {
      throw new DomainException('ADMIN_ONLY');
    }
    if (account.status !== 'ACTIVE') {
      throw new DomainException('ACCOUNT_NOT_ACTIVE');
    }
    return {
      accountId: account.id,
      displayLabel: formatAccountLabel(
        account.name,
        activeOrNull(account.credential)?.username,
      ),
    };
  }
}
