import { Inject, Injectable } from '@nestjs/common';

import { MAX_REASON_LENGTH } from '@/common/constants/reason.constants';
import { DomainException } from '@/common/errors/error-catalog';
import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseId, parseOptionalId } from '@/common/utils/id-parser';
import { parseIdCursor } from '@/common/utils/keyset-cursor';
import {
  normalizeCursorInput,
  sliceIdCursorPage,
} from '@/common/utils/pagination';
import { cleanNullableText } from '@/common/utils/text-cleaner';
import type { AdminSetStoreActiveInput } from '@/features/admin/dto/inputs/admin-set-store-active.input';
import type { AdminStoreListInput } from '@/features/admin/dto/inputs/admin-store-list.input';
import type { AdminUpdateStoreBasicInfoInput } from '@/features/admin/dto/inputs/admin-update-store-basic-info.input';
import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { toAdminStoreDetailOutput } from '@/features/admin/services/admin-store-mappers.helper';
import type {
  AdminStoreDetailOutput,
  AdminStoreOutput,
} from '@/features/admin/types/admin-output.type';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { AccountAdminRepository, AdminBaseService } from '@/features/auth';
import { StoreSellerRepository } from '@/features/store';
import { buildStoreBasicInfoUpdateData, toStoreOutput } from '@/features/store';
import {
  AuditActionType,
  AuditTargetType,
  type Prisma,
  type Store,
} from '@/generated/prisma/client';
import { assertOwnedUploadUrl } from '@/global/storage/assert-owned-upload-url';
import { S3Service } from '@/global/storage/s3.service';

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

/** 매장 내용(상품·옵션)은 판매자 몫이다. 기본 정보 갱신 규칙은 판매자 API와 같은 헬퍼(store feature)를 쓴다. */
@Injectable()
export class AdminStoreService extends AdminBaseService {
  constructor(
    accounts: AccountAdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly stores: StoreSellerRepository,
    protected readonly repo: AdminRepository,
    private readonly s3: S3Service,
  ) {
    super(accounts, auditLogs);
  }

  async adminStores(
    accountId: bigint,
    input?: AdminStoreListInput,
  ): Promise<CursorConnection<AdminStoreOutput>> {
    await this.requireAdminContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseIdCursor(input.cursor) : null,
    });
    const filter = {
      keyword: input?.keyword?.trim() || undefined,
      isActive: input?.isActive,
      regionId: parseOptionalId(input?.regionId) ?? undefined,
    };

    const [rows, totalCount] = await Promise.all([
      this.repo.listStores({ ...filter, ...normalized }),
      this.repo.countStores(filter),
    ]);
    const paged = sliceIdCursorPage(rows, normalized.limit);
    return {
      items: paged.items.map(toStoreOutput),
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
    if (!row) throw new DomainException('STORE_NOT_FOUND');
    return toAdminStoreDetailOutput(row);
  }

  async adminSetStoreActive(
    accountId: bigint,
    input: AdminSetStoreActiveInput,
  ): Promise<AdminStoreOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const reason = cleanNullableText(input.reason, MAX_REASON_LENGTH);
    // 현재 값 확인·멱등 판정은 repository가 잠금 뒤 트랜잭션 안에서 한다
    const result = await this.repo.setStoreActive(
      { storeId: parseId(input.storeId), isActive: input.isActive },
      (before, after) => ({
        actorAccountId: ctx.accountId,
        storeId: after.id,
        targetType: AuditTargetType.STORE,
        targetId: after.id,
        action: AuditActionType.STATUS_CHANGE,
        beforeJson: { isActive: before.is_active },
        afterJson: { isActive: after.is_active, reason },
      }),
    );
    if (!result) throw new DomainException('STORE_NOT_FOUND');
    return toStoreOutput(result.row);
  }

  async adminUpdateStoreBasicInfo(
    accountId: bigint,
    input: AdminUpdateStoreBasicInfoInput,
  ): Promise<AdminStoreOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const { storeId, regionId, ...patch } = input;

    const data: Prisma.StoreUpdateInput = buildStoreBasicInfoUpdateData(patch);
    if (typeof data.profile_image_url === 'string') {
      assertOwnedUploadUrl(
        this.s3,
        data.profile_image_url,
        'STORE_IMAGE',
        ctx.accountId,
        'INVALID_IMAGE_URL',
      );
    }
    let connectRegionId: bigint | undefined;
    if (regionId !== undefined) {
      // 빈 문자열은 해제가 아니라 형식 오류(BAD_USER_INPUT). 해제는 명시적 null만
      const parsed = parseOptionalId(regionId);
      // 빠른 거절 — 최종 판정은 repository가 지역을 잠근 뒤 같은 트랜잭션에서 한다
      if (parsed !== null && !(await this.stores.isRegionSelectable(parsed))) {
        throw new DomainException('REGION_NOT_SELECTABLE');
      }
      // 관계 필드는 connect/disconnect로 — null은 연결 해제
      data.region = parsed ? { connect: { id: parsed } } : { disconnect: true };
      connectRegionId = parsed ?? undefined;
    }
    const changedKeys = Object.keys(data).map((k) =>
      k === 'region' ? 'region_id' : k,
    ) as (keyof Store)[];

    // before는 repository가 잠금 뒤 트랜잭션 안에서 읽는다 — 미리 읽은 값은 낡을 수 있다
    const updated = await this.repo.updateStore(
      { storeId: parseId(storeId), data, regionId: connectRegionId },
      (before, after) => ({
        actorAccountId: ctx.accountId,
        storeId: after.id,
        targetType: AuditTargetType.STORE,
        targetId: after.id,
        action: AuditActionType.UPDATE,
        beforeJson: snapshot(before, changedKeys),
        afterJson: snapshot(after, changedKeys),
      }),
    );
    if (updated === 'region-not-selectable') {
      throw new DomainException('REGION_NOT_SELECTABLE');
    }
    if (!updated) throw new DomainException('STORE_NOT_FOUND');
    return toStoreOutput(updated);
  }
}
