import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditActionType,
  AuditTargetType,
  type Prisma,
  type Store,
} from '@prisma/client';

import {
  nextCursorOf,
  normalizeCursorInput,
} from '@/common/utils/id-cursor-page';
import { parseId } from '@/common/utils/id-parser';
import { cleanNullableText } from '@/common/utils/text-cleaner';
import {
  REGION_NOT_SELECTABLE,
  STORE_NOT_FOUND,
} from '@/features/admin/constants/admin-error-messages';
import { MAX_REASON_LENGTH } from '@/features/admin/constants/admin.constants';
import type { AdminSetStoreActiveInput } from '@/features/admin/dto/inputs/admin-set-store-active.input';
import type { AdminStoreListInput } from '@/features/admin/dto/inputs/admin-store-list.input';
import type { AdminUpdateStoreBasicInfoInput } from '@/features/admin/dto/inputs/admin-update-store-basic-info.input';
import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminBaseService } from '@/features/admin/services/admin-base.service';
import {
  toAdminStoreDetailOutput,
  toAdminStoreOutput,
} from '@/features/admin/services/admin-store-mappers.helper';
import type {
  AdminCursorConnection,
  AdminStoreDetailOutput,
  AdminStoreOutput,
} from '@/features/admin/types/admin-output.type';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { buildStoreBasicInfoUpdateData } from '@/features/store';

/** 감사 before/after에 남길 컬럼 값. bigint·Decimal·Date는 JSON에 못 실으므로 문자열로. */
function snapshot(row: Store, keys: (keyof Store)[]): Prisma.InputJsonObject {
  const out: Record<string, Prisma.InputJsonValue | null> = {};
  for (const key of keys) {
    const value = row[key];
    out[key] =
      value === null || value === undefined
        ? null
        : typeof value === 'object' || typeof value === 'bigint'
          ? String(value)
          : value;
  }
  return out;
}

/**
 * 매장 관리 — 노출 토글과 기본 정보 대리 수정. 매장 내용(상품·옵션)은 판매자 몫이다.
 * 기본 정보 갱신 규칙은 판매자 API와 같은 헬퍼(store feature)를 쓴다.
 */
@Injectable()
export class AdminStoreService extends AdminBaseService {
  constructor(
    repo: AdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
  ) {
    super(repo, auditLogs);
  }

  async adminStores(
    accountId: bigint,
    input?: AdminStoreListInput,
  ): Promise<AdminCursorConnection<AdminStoreOutput>> {
    await this.requireAdminContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseId(input.cursor) : null,
    });
    const filter = {
      keyword: input?.keyword?.trim() || undefined,
      isActive: input?.isActive,
      regionId: input?.regionId ? parseId(input.regionId) : undefined,
    };

    const [rows, totalCount] = await Promise.all([
      this.repo.listStores({ ...filter, ...normalized }),
      this.repo.countStores(filter),
    ]);
    const paged = nextCursorOf(rows, normalized.limit);
    return {
      items: paged.items.map(toAdminStoreOutput),
      totalCount,
      hasMore: paged.hasMore,
      nextCursor: paged.nextCursor,
    };
  }

  async adminStore(
    accountId: bigint,
    storeId: bigint,
  ): Promise<AdminStoreDetailOutput> {
    await this.requireAdminContext(accountId);
    const row = await this.repo.findStoreDetailById(storeId);
    if (!row) throw new NotFoundException(STORE_NOT_FOUND);
    return toAdminStoreDetailOutput(row);
  }

  async adminSetStoreActive(
    accountId: bigint,
    input: AdminSetStoreActiveInput,
  ): Promise<AdminStoreOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const current = await this.requireStore(parseId(input.storeId));
    // 같은 값이면 멱등 — 감사 기록도 남기지 않는다
    if (current.is_active === input.isActive) {
      return toAdminStoreOutput(current);
    }

    const updated = await this.repo.updateStore(
      { storeId: current.id, data: { is_active: input.isActive } },
      (row) => ({
        actorAccountId: ctx.accountId,
        storeId: row.id,
        targetType: AuditTargetType.STORE,
        targetId: row.id,
        action: AuditActionType.STATUS_CHANGE,
        beforeJson: { isActive: current.is_active },
        afterJson: {
          isActive: row.is_active,
          reason: cleanNullableText(input.reason, MAX_REASON_LENGTH),
        },
      }),
    );
    return toAdminStoreOutput(updated);
  }

  async adminUpdateStoreBasicInfo(
    accountId: bigint,
    input: AdminUpdateStoreBasicInfoInput,
  ): Promise<AdminStoreOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const { storeId, regionId, ...patch } = input;
    const current = await this.requireStore(parseId(storeId));

    const data: Prisma.StoreUpdateInput = buildStoreBasicInfoUpdateData(patch);
    if (regionId !== undefined) {
      const parsed = regionId ? parseId(regionId) : null;
      if (parsed !== null && !(await this.repo.isRegionSelectable(parsed))) {
        throw new BadRequestException(REGION_NOT_SELECTABLE);
      }
      // 관계 필드는 connect/disconnect로 — null은 연결 해제
      data.region = parsed ? { connect: { id: parsed } } : { disconnect: true };
    }
    const changedKeys = Object.keys(data).map((k) =>
      k === 'region' ? 'region_id' : k,
    ) as (keyof Store)[];

    const updated = await this.repo.updateStore(
      { storeId: current.id, data },
      (row) => ({
        actorAccountId: ctx.accountId,
        storeId: row.id,
        targetType: AuditTargetType.STORE,
        targetId: row.id,
        action: AuditActionType.UPDATE,
        beforeJson: snapshot(current, changedKeys),
        afterJson: snapshot(row, changedKeys),
      }),
    );
    return toAdminStoreOutput(updated);
  }

  private async requireStore(storeId: bigint): Promise<Store> {
    const row = await this.repo.findStoreById(storeId);
    if (!row) throw new NotFoundException(STORE_NOT_FOUND);
    return row;
  }
}
