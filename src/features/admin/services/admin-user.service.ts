import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountStatus,
  AccountType,
  AuditActionType,
  AuditTargetType,
} from '@prisma/client';

import {
  nextCursorOf,
  normalizeCursorInput,
} from '@/common/utils/id-cursor-page';
import { parseId } from '@/common/utils/id-parser';
import { cleanRequiredText } from '@/common/utils/text-cleaner';
import {
  ACCOUNT_NOT_FOUND,
  CANNOT_CHANGE_ADMIN_STATUS,
  CANNOT_CHANGE_OWN_STATUS,
  ONLY_ACTIVE_CAN_BE_SUSPENDED,
  ONLY_SUSPENDED_CAN_BE_REINSTATED,
  USER_NOT_FOUND,
} from '@/features/admin/constants/admin-error-messages';
import { MAX_REASON_LENGTH } from '@/features/admin/constants/admin.constants';
import type { AdminSuspendAccountInput } from '@/features/admin/dto/inputs/admin-suspend-account.input';
import type { AdminUserListInput } from '@/features/admin/dto/inputs/admin-user-list.input';
import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminBaseService } from '@/features/admin/services/admin-base.service';
import { toAdminUserOutput } from '@/features/admin/services/admin-user-mappers.helper';
import type {
  AdminAccountStatusResultOutput,
  AdminCursorConnection,
  AdminUserOutput,
} from '@/features/admin/types/admin-output.type';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';

/**
 * 구매자 조회와 계정 정지/복구(USER·SELLER 공통).
 * 정지는 JwtBearerStrategy가 ACTIVE만 통과시키므로 즉시 모든 API가 막히고, refresh 세션도 폐기한다.
 */
@Injectable()
export class AdminUserService extends AdminBaseService {
  constructor(
    repo: AdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
  ) {
    super(repo, auditLogs);
  }

  async adminUsers(
    accountId: bigint,
    input?: AdminUserListInput,
  ): Promise<AdminCursorConnection<AdminUserOutput>> {
    await this.requireAdminContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseId(input.cursor) : null,
    });
    const filter = {
      keyword: input?.keyword?.trim() || undefined,
      status: input?.status,
    };

    const [rows, totalCount] = await Promise.all([
      this.repo.listUserAccounts({ ...filter, ...normalized }),
      this.repo.countUserAccounts(filter),
    ]);
    const paged = nextCursorOf(rows, normalized.limit);
    return {
      items: paged.items.map(toAdminUserOutput),
      totalCount,
      hasMore: paged.hasMore,
      nextCursor: paged.nextCursor,
    };
  }

  async adminUser(
    accountId: bigint,
    targetAccountId: bigint,
  ): Promise<AdminUserOutput> {
    await this.requireAdminContext(accountId);
    const row = await this.repo.findUserAccountById(targetAccountId);
    if (!row) throw new NotFoundException(USER_NOT_FOUND);
    return toAdminUserOutput(row);
  }

  async adminSuspendAccount(
    accountId: bigint,
    input: AdminSuspendAccountInput,
  ): Promise<AdminAccountStatusResultOutput> {
    const reason = cleanRequiredText(input.reason, MAX_REASON_LENGTH);
    return this.changeStatus(accountId, parseId(input.accountId), {
      to: AccountStatus.SUSPENDED,
      reason,
    });
  }

  async adminReinstateAccount(
    accountId: bigint,
    targetAccountId: bigint,
  ): Promise<AdminAccountStatusResultOutput> {
    return this.changeStatus(accountId, targetAccountId, {
      to: AccountStatus.ACTIVE,
      reason: null,
    });
  }

  private async changeStatus(
    accountId: bigint,
    targetAccountId: bigint,
    change: { to: AccountStatus; reason: string | null },
  ): Promise<AdminAccountStatusResultOutput> {
    const ctx = await this.requireAdminContext(accountId);
    // 정책: 관리자 본인·다른 ADMIN 계정은 정지/복구 대상이 아니다(잠금 사고 방지)
    if (targetAccountId === ctx.accountId) {
      throw new ForbiddenException(CANNOT_CHANGE_OWN_STATUS);
    }
    const target = await this.repo.findAccountForStatusChange(targetAccountId);
    if (!target) throw new NotFoundException(ACCOUNT_NOT_FOUND);
    if (target.account_type === AccountType.ADMIN) {
      throw new ForbiddenException(CANNOT_CHANGE_ADMIN_STATUS);
    }

    // 같은 상태면 멱등 — 감사 기록도 남기지 않는다
    if (target.status === change.to) {
      return {
        accountId: target.id.toString(),
        accountType: target.account_type,
        status: change.to,
      };
    }
    // 전이는 ACTIVE ⇄ SUSPENDED만. PENDING(승인 전)을 정지했다 복구하면 승인 없이 ACTIVE가 되므로 막는다
    const from =
      change.to === AccountStatus.SUSPENDED
        ? AccountStatus.ACTIVE
        : AccountStatus.SUSPENDED;
    const invalidTransitionMessage =
      change.to === AccountStatus.SUSPENDED
        ? ONLY_ACTIVE_CAN_BE_SUSPENDED
        : ONLY_SUSPENDED_CAN_BE_REINSTATED;
    if (target.status !== from) {
      throw new BadRequestException(invalidTransitionMessage);
    }
    {
      // 사전 검사와 갱신 사이의 경쟁은 repository의 조건부 갱신이 닫는다
      await this.repo.updateAccountStatus({
        accountId: target.id,
        from,
        to: change.to,
        invalidTransitionMessage,
        // 정지에서만 세션을 끊는다. 복구는 새 로그인부터 유효
        revokeSessions: change.to === AccountStatus.SUSPENDED,
        audit: {
          actorAccountId: ctx.accountId,
          storeId: target.store?.id ?? null,
          targetType: AuditTargetType.ACCOUNT,
          targetId: target.id,
          action: AuditActionType.STATUS_CHANGE,
          beforeJson: { status: target.status },
          afterJson: { status: change.to, reason: change.reason },
        },
      });
    }

    return {
      accountId: target.id.toString(),
      accountType: target.account_type,
      status: change.to,
    };
  }
}
