import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  LATITUDE_RANGE,
  LONGITUDE_RANGE,
  parseDecimalOrNull,
} from '@/common/utils/decimal-parser';
import { parseId, parseOptionalId } from '@/common/utils/id-parser';
import { cleanRequiredText } from '@/common/utils/text-cleaner';
import {
  INVALID_DECIMAL_VALUE,
  PARENT_REGION_INVALID,
  REGION_HAS_ACTIVE_CHILDREN,
  REGION_HAS_CHILDREN,
  REGION_HAS_STORES,
  REGION_NOT_FOUND,
  REGION_PARENT_INACTIVE,
  REGION_SLUG_TAKEN,
} from '@/features/admin/constants/admin-error-messages';
import { MAX_REGION_NAME_LENGTH } from '@/features/admin/constants/admin.constants';
import type { AdminCreateRegionInput } from '@/features/admin/dto/inputs/admin-create-region.input';
import type { AdminRegionListInput } from '@/features/admin/dto/inputs/admin-region-list.input';
import type { AdminUpdateRegionInput } from '@/features/admin/dto/inputs/admin-update-region.input';
import {
  AdminRepository,
  type AdminRegionRow,
} from '@/features/admin/repositories/admin.repository';
import { AdminBaseService } from '@/features/admin/services/admin-base.service';
import { toAdminRegionOutput } from '@/features/admin/services/admin-region-mappers.helper';
import type { AdminRegionOutput } from '@/features/admin/types/admin-output.type';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import {
  AuditActionType,
  AuditTargetType,
  type Prisma,
} from '@/generated/prisma/client';

/**
 * 지역 마스터 관리(시드 전용이던 값). level은 parentId 유무로 정해지고 바뀌지 않는다.
 * 삭제는 연결된 매장·활성 하위 지역이 없을 때만(soft-delete). 삭제된 slug는 복구한다(unique 인덱스).
 */
@Injectable()
export class AdminRegionService extends AdminBaseService {
  constructor(
    repo: AdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
  ) {
    super(repo, auditLogs);
  }

  async adminRegions(
    accountId: bigint,
    input?: AdminRegionListInput,
  ): Promise<AdminRegionOutput[]> {
    await this.requireAdminContext(accountId);
    const rows = await this.repo.listRegions({
      parentId: parseOptionalId(input?.parentId) ?? undefined,
      includeInactive: input?.includeInactive ?? false,
    });
    return rows.map(toAdminRegionOutput);
  }

  async adminCreateRegion(
    accountId: bigint,
    input: AdminCreateRegionInput,
  ): Promise<AdminRegionOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const parentId = parseOptionalId(input.parentId);
    if (parentId !== null && !(await this.repo.isActiveRegionGroup(parentId))) {
      throw new BadRequestException(PARENT_REGION_INVALID);
    }
    const slug = input.slug.trim();
    if (await this.repo.existsActiveRegionSlug(slug)) {
      throw new BadRequestException(REGION_SLUG_TAKEN);
    }
    const data = {
      parent_id: parentId,
      level: parentId === null ? 1 : 2,
      name: cleanRequiredText(input.name, MAX_REGION_NAME_LENGTH),
      slug,
      sort_order: input.sortOrder ?? 0,
      is_active: input.isActive ?? true,
      center_lat: parseDecimalOrNull(
        input.centerLat,
        INVALID_DECIMAL_VALUE,
        LATITUDE_RANGE,
      ),
      center_lng: parseDecimalOrNull(
        input.centerLng,
        INVALID_DECIMAL_VALUE,
        LONGITUDE_RANGE,
      ),
    };
    // 상위 활성·slug 충돌의 최종 판정은 repository가 잠금 뒤 트랜잭션 안에서 한다(위는 빠른 거절)
    const row = await this.repo.createOrRestoreRegion(data, (created) => ({
      actorAccountId: ctx.accountId,
      storeId: null,
      targetType: AuditTargetType.REGION,
      targetId: created.id,
      action: AuditActionType.CREATE,
      afterJson: this.snapshot(created),
    }));
    if (row === 'parent-not-active') {
      throw new BadRequestException(PARENT_REGION_INVALID);
    }
    if (row === 'slug-taken') throw new BadRequestException(REGION_SLUG_TAKEN);
    return toAdminRegionOutput(row);
  }

  async adminUpdateRegion(
    accountId: bigint,
    input: AdminUpdateRegionInput,
  ): Promise<AdminRegionOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const regionId = parseId(input.regionId);
    const current = await this.repo.findRegionById(regionId);
    if (!current) throw new NotFoundException(REGION_NOT_FOUND);

    const data: Prisma.RegionUpdateInput = {
      ...(input.name !== undefined
        ? { name: cleanRequiredText(input.name, MAX_REGION_NAME_LENGTH) }
        : {}),
      ...(input.slug !== undefined ? { slug: input.slug.trim() } : {}),
      ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
      ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
      ...(input.centerLat !== undefined
        ? {
            center_lat: parseDecimalOrNull(
              input.centerLat,
              INVALID_DECIMAL_VALUE,
              LATITUDE_RANGE,
            ),
          }
        : {}),
      ...(input.centerLng !== undefined
        ? {
            center_lng: parseDecimalOrNull(
              input.centerLng,
              INVALID_DECIMAL_VALUE,
              LONGITUDE_RANGE,
            ),
          }
        : {}),
    };
    if (
      typeof data.slug === 'string' &&
      data.slug !== current.slug &&
      (await this.repo.existsActiveRegionSlug(data.slug))
    ) {
      throw new BadRequestException(REGION_SLUG_TAKEN);
    }

    const row = await this.repo.updateRegion(
      { regionId, data },
      (before, after) => ({
        actorAccountId: ctx.accountId,
        storeId: null,
        targetType: AuditTargetType.REGION,
        targetId: after.id,
        action: AuditActionType.UPDATE,
        beforeJson: this.snapshot(before),
        afterJson: this.snapshot(after),
      }),
    );
    switch (row) {
      case 'not-found':
        throw new NotFoundException(REGION_NOT_FOUND);
      case 'slug-taken':
        throw new BadRequestException(REGION_SLUG_TAKEN);
      case 'has-active-children':
        throw new BadRequestException(REGION_HAS_ACTIVE_CHILDREN);
      case 'parent-not-active':
        throw new BadRequestException(REGION_PARENT_INACTIVE);
      default:
        return toAdminRegionOutput(row);
    }
  }

  async adminDeleteRegion(
    accountId: bigint,
    regionId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireAdminContext(accountId);
    const result = await this.repo.softDeleteRegion(regionId, (before) => ({
      actorAccountId: ctx.accountId,
      storeId: null,
      targetType: AuditTargetType.REGION,
      targetId: before.id,
      action: AuditActionType.DELETE,
      beforeJson: this.snapshot(before),
    }));
    if (result === 'not-found') throw new NotFoundException(REGION_NOT_FOUND);
    if (result === 'has-stores')
      throw new BadRequestException(REGION_HAS_STORES);
    if (result === 'has-children') {
      throw new BadRequestException(REGION_HAS_CHILDREN);
    }
    return true;
  }

  private snapshot(row: AdminRegionRow): Prisma.InputJsonObject {
    return {
      parentId: row.parent_id?.toString() ?? null,
      level: row.level,
      name: row.name,
      slug: row.slug,
      sortOrder: row.sort_order,
      isActive: row.is_active,
      centerLat: row.center_lat?.toString() ?? null,
      centerLng: row.center_lng?.toString() ?? null,
    };
  }
}
