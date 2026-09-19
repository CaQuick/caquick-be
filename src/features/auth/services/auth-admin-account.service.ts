import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';

import type { CursorInput } from '@/common/dto/inputs/cursor.input';
import { DomainException } from '@/common/errors/error-catalog';
import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseIdCursor } from '@/common/utils/keyset-cursor';
import {
  normalizeCursorInput,
  sliceIdCursorPage,
} from '@/common/utils/pagination';
import { cleanNullableText } from '@/common/utils/text-cleaner';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  MAX_ACCOUNT_NAME_LENGTH,
  MAX_EMAIL_LENGTH,
} from '@/features/auth/constants/auth-admin.constants';
import type { AdminCreateAdminInput } from '@/features/auth/dto/inputs/admin-create-admin.input';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { AdminBaseService } from '@/features/auth/services/auth-admin-base.service';
import { toAdminAccountOutput } from '@/features/auth/services/auth-admin-mappers.helper';
import type { AdminAccountOutput } from '@/features/auth/types/auth-admin-output.type';

@Injectable()
export class AdminAccountService extends AdminBaseService {
  constructor(
    accounts: AccountAdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
  ) {
    super(accounts, auditLogs);
  }

  async adminMe(accountId: bigint): Promise<AdminAccountOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const row = await this.accounts.findAdminAccountById(ctx.accountId);
    if (!row) throw new DomainException('ACCOUNT_NOT_FOUND');
    return toAdminAccountOutput(row);
  }

  async adminAdmins(
    accountId: bigint,
    input?: CursorInput,
  ): Promise<CursorConnection<AdminAccountOutput>> {
    await this.requireAdminContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseIdCursor(input.cursor) : null,
    });

    const [rows, totalCount] = await Promise.all([
      this.accounts.listAdminAccounts(normalized),
      this.accounts.countAdminAccounts(),
    ]);
    const paged = sliceIdCursorPage(rows, normalized.limit);
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
    // username은 DTO(USERNAME_PATTERN)가 공백을 거절하므로 여기서 다듬지 않는다
    const { username } = input;
    // 사전 조회로 흔한 중복을 잡고, 경쟁·soft-delete 잔재는 repository의 P2002 매핑이 막는다
    if (await this.accounts.existsCredentialUsername(username)) {
      throw new DomainException('USERNAME_TAKEN');
    }

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });
    // 감사 기록은 repository가 같은 트랜잭션에 남긴다
    const created = await this.accounts.createAdminAccount({
      actorAccountId: ctx.accountId,
      username,
      passwordHash,
      email: cleanNullableText(input.email, MAX_EMAIL_LENGTH),
      name: cleanNullableText(input.name, MAX_ACCOUNT_NAME_LENGTH),
    });

    return toAdminAccountOutput(created);
  }
}
