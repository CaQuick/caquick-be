import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditActionType, AuditTargetType } from '@prisma/client';
import argon2 from 'argon2';

import {
  nextCursorOf,
  normalizeCursorInput,
} from '@/common/utils/id-cursor-page';
import { parseId } from '@/common/utils/id-parser';
import { cleanNullableText } from '@/common/utils/text-cleaner';
import {
  ACCOUNT_NOT_FOUND,
  USERNAME_TAKEN,
} from '@/features/admin/constants/admin-error-messages';
import {
  MAX_ACCOUNT_NAME_LENGTH,
  MAX_EMAIL_LENGTH,
} from '@/features/admin/constants/admin.constants';
import type { AdminCreateAdminInput } from '@/features/admin/dto/inputs/admin-create-admin.input';
import type { AdminCursorInput } from '@/features/admin/dto/inputs/admin-cursor.input';
import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { toAdminAccountOutput } from '@/features/admin/services/admin-account-mappers.helper';
import { AdminBaseService } from '@/features/admin/services/admin-base.service';
import type {
  AdminAccountOutput,
  AdminCursorConnection,
} from '@/features/admin/types/admin-output.type';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';

@Injectable()
export class AdminAccountService extends AdminBaseService {
  constructor(
    repo: AdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
  ) {
    super(repo, auditLogs);
  }

  async adminMe(accountId: bigint): Promise<AdminAccountOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const row = await this.repo.findAdminAccountById(ctx.accountId);
    if (!row) throw new NotFoundException(ACCOUNT_NOT_FOUND);
    return toAdminAccountOutput(row);
  }

  async adminAdmins(
    accountId: bigint,
    input?: AdminCursorInput,
  ): Promise<AdminCursorConnection<AdminAccountOutput>> {
    await this.requireAdminContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseId(input.cursor) : null,
    });

    const [rows, totalCount] = await Promise.all([
      this.repo.listAdminAccounts(normalized),
      this.repo.countAdminAccounts(),
    ]);
    const paged = nextCursorOf(rows, normalized.limit);
    return {
      items: paged.items.map(toAdminAccountOutput),
      totalCount,
      hasMore: paged.hasMore,
      nextCursor: paged.nextCursor,
    };
  }

  async adminCreateAdmin(
    accountId: bigint,
    input: AdminCreateAdminInput,
  ): Promise<AdminAccountOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const username = input.username.trim();
    // 사전 조회로 흔한 중복을 잡고, 경쟁·soft-delete 잔재는 repository의 P2002 매핑이 막는다
    if (await this.repo.existsCredentialUsername(username)) {
      throw new BadRequestException(USERNAME_TAKEN);
    }

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });
    const created = await this.repo.createAdminAccount({
      username,
      passwordHash,
      email: cleanNullableText(input.email, MAX_EMAIL_LENGTH),
      name: cleanNullableText(input.name, MAX_ACCOUNT_NAME_LENGTH),
    });

    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: null,
      targetType: AuditTargetType.ACCOUNT,
      targetId: created.id,
      action: AuditActionType.CREATE,
      afterJson: { accountType: 'ADMIN', username },
    });

    return toAdminAccountOutput(created);
  }
}
