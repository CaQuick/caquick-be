import { Inject, Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import { parseSearchKeyword } from '@/common/utils/search-keyword';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { AccountAdminRepository, AdminBaseService } from '@/features/auth';
import type { AdminCreateSearchKeywordChipInput } from '@/features/search/dto/inputs/admin-create-search-keyword-chip.input';
import type { AdminReorderSearchKeywordChipsInput } from '@/features/search/dto/inputs/admin-reorder-search-keyword-chips.input';
import type { AdminUpdateSearchKeywordChipInput } from '@/features/search/dto/inputs/admin-update-search-keyword-chip.input';
import {
  SearchAdminRepository,
  type SearchKeywordChipRow,
} from '@/features/search/repositories/search-admin.repository';
import { toAdminSearchKeywordChipOutput } from '@/features/search/services/search-admin-mappers.helper';
import type { AdminSearchKeywordChipOutput } from '@/features/search/types/search-admin-output.type';
import {
  AuditActionType,
  AuditTargetType,
  type Prisma,
} from '@/generated/prisma/client';

/** 배너와 같은 규칙 — 시작이 종료보다 늦거나 같으면 노출될 수 없다. 한쪽만 있거나 둘 다 없으면 허용. */
function assertExposureWindow(final: {
  startsAt: Date | null;
  endsAt: Date | null;
}): void {
  if (final.startsAt && final.endsAt && final.startsAt >= final.endsAt) {
    throw new DomainException('INVALID_EXPOSURE_WINDOW');
  }
}

/** 칩 키워드는 검색과 같은 규칙으로 정규화한다 — FE가 칩 문구를 그대로 검색·recordSearch에 넘긴다. */
@Injectable()
export class AdminSearchKeywordChipService extends AdminBaseService {
  constructor(
    accounts: AccountAdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    protected readonly repo: SearchAdminRepository,
  ) {
    super(accounts, auditLogs);
  }

  async adminSearchKeywordChips(
    accountId: bigint,
  ): Promise<AdminSearchKeywordChipOutput[]> {
    await this.requireAdminContext(accountId);
    const rows = await this.repo.listChips();
    return rows.map(toAdminSearchKeywordChipOutput);
  }

  async adminCreateSearchKeywordChip(
    accountId: bigint,
    input: AdminCreateSearchKeywordChipInput,
  ): Promise<AdminSearchKeywordChipOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const { keyword } = parseSearchKeyword(input.keyword);
    const window = {
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
    };
    assertExposureWindow(window);

    const row = await this.repo.createChip(
      { keyword, isActive: input.isActive ?? true, ...window },
      (created) => ({
        actorAccountId: ctx.accountId,
        storeId: null,
        targetType: AuditTargetType.SEARCH_KEYWORD_CHIP,
        targetId: created.id,
        action: AuditActionType.CREATE,
        afterJson: this.snapshot(created),
      }),
    );
    if (row === 'keyword-taken') {
      throw new DomainException('SEARCH_KEYWORD_CHIP_TAKEN');
    }
    return toAdminSearchKeywordChipOutput(row);
  }

  async adminUpdateSearchKeywordChip(
    accountId: bigint,
    input: AdminUpdateSearchKeywordChipInput,
  ): Promise<AdminSearchKeywordChipOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const row = await this.repo.updateChip(
      {
        chipId: parseId(input.chipId),
        keyword:
          input.keyword !== undefined
            ? parseSearchKeyword(input.keyword).keyword
            : undefined,
        isActive: input.isActive,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      },
      // 기간은 잠금 뒤 현재 값과 병합한 최종 상태로 검증한다 — 한쪽만 보내도 기존 값과 어긋날 수 있다
      assertExposureWindow,
      (before, after) => ({
        actorAccountId: ctx.accountId,
        storeId: null,
        targetType: AuditTargetType.SEARCH_KEYWORD_CHIP,
        targetId: after.id,
        action: AuditActionType.UPDATE,
        beforeJson: this.snapshot(before),
        afterJson: this.snapshot(after),
      }),
    );
    if (row === 'not-found') {
      throw new DomainException('SEARCH_KEYWORD_CHIP_NOT_FOUND');
    }
    if (row === 'keyword-taken') {
      throw new DomainException('SEARCH_KEYWORD_CHIP_TAKEN');
    }
    return toAdminSearchKeywordChipOutput(row);
  }

  async adminDeleteSearchKeywordChip(
    accountId: bigint,
    chipId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireAdminContext(accountId);
    const result = await this.repo.softDeleteChip(chipId, (before) => ({
      actorAccountId: ctx.accountId,
      storeId: null,
      targetType: AuditTargetType.SEARCH_KEYWORD_CHIP,
      targetId: before.id,
      action: AuditActionType.DELETE,
      beforeJson: this.snapshot(before),
    }));
    if (result === 'not-found') {
      throw new DomainException('SEARCH_KEYWORD_CHIP_NOT_FOUND');
    }
    return true;
  }

  /** 순서 변경은 칩마다 UPDATE 감사를 남긴다 — 감사 로그의 대상별 필터가 칩 단위로 동작하도록. */
  async adminReorderSearchKeywordChips(
    accountId: bigint,
    input: AdminReorderSearchKeywordChipsInput,
  ): Promise<AdminSearchKeywordChipOutput[]> {
    const ctx = await this.requireAdminContext(accountId);
    const chipIds = input.chipIds.map((id) => parseId(id));
    if (new Set(chipIds).size !== chipIds.length) {
      throw new DomainException('DUPLICATE_IDS');
    }

    const rows = await this.repo.reorderChips(chipIds, (before, after) => ({
      actorAccountId: ctx.accountId,
      storeId: null,
      targetType: AuditTargetType.SEARCH_KEYWORD_CHIP,
      targetId: after.id,
      action: AuditActionType.UPDATE,
      beforeJson: this.snapshot(before),
      afterJson: this.snapshot(after),
    }));
    if (rows === 'length-mismatch') {
      throw new DomainException('IDS_LENGTH_MISMATCH', { field: 'chipIds' });
    }
    if (rows === 'invalid-ids') {
      throw new DomainException('INVALID_IDS', { field: 'chipIds' });
    }
    return rows.map(toAdminSearchKeywordChipOutput);
  }

  private snapshot(row: SearchKeywordChipRow): Prisma.InputJsonObject {
    return {
      keyword: row.keyword,
      sortOrder: row.sort_order,
      isActive: row.is_active,
      startsAt: row.starts_at?.toISOString() ?? null,
      endsAt: row.ends_at?.toISOString() ?? null,
    };
  }
}
