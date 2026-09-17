import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import argon2 from 'argon2';

import type { CursorInput } from '@/common/dto/inputs/cursor.input';
import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseIdCursor } from '@/common/utils/keyset-cursor';
import {
  normalizeCursorInput,
  sliceIdCursorPage,
} from '@/common/utils/pagination';
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
import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { toAdminAccountOutput } from '@/features/admin/services/admin-account-mappers.helper';
import { AdminBaseService } from '@/features/admin/services/admin-base.service';
import type { AdminAccountOutput } from '@/features/admin/types/admin-output.type';
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
    input?: CursorInput,
  ): Promise<CursorConnection<AdminAccountOutput>> {
    await this.requireAdminContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseIdCursor(input.cursor) : null,
    });

    const [rows, totalCount] = await Promise.all([
      this.repo.listAdminAccounts(normalized),
      this.repo.countAdminAccounts(),
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
    if (await this.repo.existsCredentialUsername(username)) {
      throw new BadRequestException(USERNAME_TAKEN);
    }

    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });
    // 감사 기록은 repository가 같은 트랜잭션에 남긴다
    const created = await this.repo.createAdminAccount({
      actorAccountId: ctx.accountId,
      username,
      passwordHash,
      email: cleanNullableText(input.email, MAX_EMAIL_LENGTH),
      name: cleanNullableText(input.name, MAX_ACCOUNT_NAME_LENGTH),
    });

    return toAdminAccountOutput(created);
  }
}
