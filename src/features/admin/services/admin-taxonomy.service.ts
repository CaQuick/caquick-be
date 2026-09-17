import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { CursorConnection } from '@/common/types/cursor-connection.type';
import { parseId } from '@/common/utils/id-parser';
import { parseIdCursor } from '@/common/utils/keyset-cursor';
import {
  normalizeCursorInput,
  sliceIdCursorPage,
} from '@/common/utils/pagination';
import {
  cleanNullableText,
  cleanRequiredText,
} from '@/common/utils/text-cleaner';
import {
  CATEGORY_NAME_TAKEN,
  CATEGORY_NOT_FOUND,
  TAG_NAME_TAKEN,
  TAG_NOT_FOUND,
  INVALID_CURSOR,
} from '@/features/admin/constants/admin-error-messages';
import {
  MAX_CATEGORY_DESCRIPTION_LENGTH,
  MAX_CATEGORY_NAME_LENGTH,
  MAX_TAG_NAME_LENGTH,
} from '@/features/admin/constants/admin.constants';
import type { AdminCategoryListInput } from '@/features/admin/dto/inputs/admin-category-list.input';
import type { AdminCreateCategoryInput } from '@/features/admin/dto/inputs/admin-create-category.input';
import type { AdminCreateTagInput } from '@/features/admin/dto/inputs/admin-create-tag.input';
import type { AdminTagListInput } from '@/features/admin/dto/inputs/admin-tag-list.input';
import type { AdminUpdateCategoryInput } from '@/features/admin/dto/inputs/admin-update-category.input';
import type { AdminUpdateTagInput } from '@/features/admin/dto/inputs/admin-update-tag.input';
import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminBaseService } from '@/features/admin/services/admin-base.service';
import {
  toAdminCategoryOutput,
  toAdminTagOutput,
} from '@/features/admin/services/admin-taxonomy-mappers.helper';
import type {
  AdminCategoryOutput,
  AdminTagOutput,
} from '@/features/admin/types/admin-output.type';
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
 * 카테고리·태그 마스터 관리. 시드에서만 만들 수 있던 값을 운영자가 관리한다.
 * 삭제는 soft-delete + 상품 연결 해제. 삭제된 같은 이름은 새로 만들지 않고 복구한다 —
 * unique 인덱스가 삭제 행도 세므로 새 행을 만들 수 없기 때문이다.
 */
@Injectable()
export class AdminTaxonomyService extends AdminBaseService {
  constructor(
    repo: AdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
  ) {
    super(repo, auditLogs);
  }

  // ── 카테고리 ──

  async adminCategories(
    accountId: bigint,
    input?: AdminCategoryListInput,
  ): Promise<AdminCategoryOutput[]> {
    await this.requireAdminContext(accountId);
    const rows = await this.repo.listCategories({
      categoryType: input?.categoryType,
      includeInactive: input?.includeInactive ?? false,
    });
    return rows.map(toAdminCategoryOutput);
  }

  async adminCreateCategory(
    accountId: bigint,
    input: AdminCreateCategoryInput,
  ): Promise<AdminCategoryOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const name = cleanRequiredText(input.name, MAX_CATEGORY_NAME_LENGTH);
    if (await this.repo.existsActiveCategoryName(input.categoryType, name)) {
      throw new BadRequestException(CATEGORY_NAME_TAKEN);
    }
    const data = {
      category_type: input.categoryType,
      name,
      description: cleanNullableText(
        input.description,
        MAX_CATEGORY_DESCRIPTION_LENGTH,
      ),
      sort_order: input.sortOrder ?? 0,
      is_active: input.isActive ?? true,
    };
    const row = await this.repo.createOrRestoreCategory(data, (created) => ({
      actorAccountId: ctx.accountId,
      storeId: null,
      targetType: AuditTargetType.CATEGORY,
      targetId: created.id,
      action: AuditActionType.CREATE,
      afterJson: { categoryType: data.category_type, name: data.name },
    }));
    return toAdminCategoryOutput(row);
  }

  async adminUpdateCategory(
    accountId: bigint,
    input: AdminUpdateCategoryInput,
  ): Promise<AdminCategoryOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const current = await this.repo.findCategoryById(parseId(input.categoryId));
    if (!current) throw new NotFoundException(CATEGORY_NOT_FOUND);

    const data: Prisma.CategoryUpdateInput = {
      ...(input.name !== undefined
        ? { name: cleanRequiredText(input.name, MAX_CATEGORY_NAME_LENGTH) }
        : {}),
      ...(input.description !== undefined
        ? {
            description: cleanNullableText(
              input.description,
              MAX_CATEGORY_DESCRIPTION_LENGTH,
            ),
          }
        : {}),
      ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
      ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
    };
    if (
      typeof data.name === 'string' &&
      data.name !== current.name &&
      (await this.repo.existsActiveCategoryName(
        current.category_type,
        data.name,
      ))
    ) {
      throw new BadRequestException(CATEGORY_NAME_TAKEN);
    }

    // before는 repository가 잠금 뒤 트랜잭션 안에서 읽는다 — current는 검증용
    const row = await this.repo.updateCategory(
      { categoryId: current.id, data },
      (before, after) => ({
        actorAccountId: ctx.accountId,
        storeId: null,
        targetType: AuditTargetType.CATEGORY,
        targetId: after.id,
        action: AuditActionType.UPDATE,
        beforeJson: this.categorySnapshot(before),
        afterJson: this.categorySnapshot(after),
      }),
    );
    if (!row) throw new NotFoundException(CATEGORY_NOT_FOUND);
    return toAdminCategoryOutput(row);
  }

  async adminDeleteCategory(
    accountId: bigint,
    categoryId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireAdminContext(accountId);
    const deleted = await this.repo.softDeleteCategory(
      categoryId,
      (before) => ({
        actorAccountId: ctx.accountId,
        storeId: null,
        targetType: AuditTargetType.CATEGORY,
        targetId: before.id,
        action: AuditActionType.DELETE,
        beforeJson: this.categorySnapshot(before),
      }),
    );
    if (!deleted) throw new NotFoundException(CATEGORY_NOT_FOUND);
    return true;
  }

  // ── 태그 ──

  async adminTags(
    accountId: bigint,
    input?: AdminTagListInput,
  ): Promise<CursorConnection<AdminTagOutput>> {
    await this.requireAdminContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor
        ? parseIdCursor(input.cursor, INVALID_CURSOR)
        : null,
    });
    const keyword = input?.keyword?.trim() || undefined;

    const [rows, totalCount] = await Promise.all([
      this.repo.listTags({ keyword, ...normalized }),
      this.repo.countTags({ keyword }),
    ]);
    const paged = sliceIdCursorPage(rows, normalized.limit);
    return {
      items: paged.items.map(toAdminTagOutput),
      totalCount,
      hasMore: paged.hasMore,
      nextCursor: paged.nextCursor,
    };
  }

  async adminCreateTag(
    accountId: bigint,
    input: AdminCreateTagInput,
  ): Promise<AdminTagOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const name = cleanRequiredText(input.name, MAX_TAG_NAME_LENGTH);
    if (await this.repo.existsActiveTagName(name)) {
      throw new BadRequestException(TAG_NAME_TAKEN);
    }
    const row = await this.repo.createOrRestoreTag(name, (created) => ({
      actorAccountId: ctx.accountId,
      storeId: null,
      targetType: AuditTargetType.TAG,
      targetId: created.id,
      action: AuditActionType.CREATE,
      afterJson: { name },
    }));
    return toAdminTagOutput(row);
  }

  async adminUpdateTag(
    accountId: bigint,
    input: AdminUpdateTagInput,
  ): Promise<AdminTagOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const current = await this.repo.findTagById(parseId(input.tagId));
    if (!current) throw new NotFoundException(TAG_NOT_FOUND);
    const name = cleanRequiredText(input.name, MAX_TAG_NAME_LENGTH);
    if (name !== current.name && (await this.repo.existsActiveTagName(name))) {
      throw new BadRequestException(TAG_NAME_TAKEN);
    }

    const row = await this.repo.updateTag(
      { tagId: current.id, name },
      (before, after) => ({
        actorAccountId: ctx.accountId,
        storeId: null,
        targetType: AuditTargetType.TAG,
        targetId: after.id,
        action: AuditActionType.UPDATE,
        beforeJson: { name: before.name },
        afterJson: { name: after.name },
      }),
    );
    if (!row) throw new NotFoundException(TAG_NOT_FOUND);
    return toAdminTagOutput(row);
  }

  async adminDeleteTag(accountId: bigint, tagId: bigint): Promise<boolean> {
    const ctx = await this.requireAdminContext(accountId);
    const deleted = await this.repo.softDeleteTag(tagId, (before) => ({
      actorAccountId: ctx.accountId,
      storeId: null,
      targetType: AuditTargetType.TAG,
      targetId: before.id,
      action: AuditActionType.DELETE,
      beforeJson: { name: before.name },
    }));
    if (!deleted) throw new NotFoundException(TAG_NOT_FOUND);
    return true;
  }

  private categorySnapshot(row: {
    category_type: string;
    name: string;
    description: string | null;
    sort_order: number;
    is_active: boolean;
  }): Prisma.InputJsonObject {
    return {
      categoryType: row.category_type,
      name: row.name,
      description: row.description,
      sortOrder: row.sort_order,
      isActive: row.is_active,
    };
  }
}
