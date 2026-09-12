import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditActionType,
  AuditTargetType,
  type Banner,
  type BannerLinkType,
  type Prisma,
} from '@prisma/client';

import { toDate } from '@/common/utils/date-parser';
import {
  nextCursorOf,
  normalizeCursorInput,
} from '@/common/utils/id-cursor-page';
import { parseId } from '@/common/utils/id-parser';
import {
  cleanNullableText,
  cleanRequiredText,
} from '@/common/utils/text-cleaner';
import {
  BANNER_NOT_FOUND,
  LINK_CATEGORY_NOT_FOUND,
  LINK_CATEGORY_REQUIRED,
  LINK_FIELDS_MISMATCH,
  LINK_PRODUCT_NOT_FOUND,
  LINK_PRODUCT_REQUIRED,
  LINK_STORE_NOT_FOUND,
  LINK_STORE_REQUIRED,
  LINK_URL_REQUIRED,
} from '@/features/admin/constants/admin-error-messages';
import {
  MAX_BANNER_TITLE_LENGTH,
  MAX_URL_LENGTH,
} from '@/features/admin/constants/admin.constants';
import type { AdminBannerListInput } from '@/features/admin/dto/inputs/admin-banner-list.input';
import type { AdminCreateBannerInput } from '@/features/admin/dto/inputs/admin-create-banner.input';
import type { AdminUpdateBannerInput } from '@/features/admin/dto/inputs/admin-update-banner.input';
import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminBaseService } from '@/features/admin/services/admin-base.service';
import { toAdminBannerOutput } from '@/features/admin/services/admin-content-mappers.helper';
import type {
  AdminBannerOutput,
  AdminCursorConnection,
} from '@/features/admin/types/admin-output.type';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';

/** linkType이 결정된 뒤의 링크 값 묶음. 생성·수정이 같은 검증을 탄다. */
interface BannerLinkValues {
  linkType: BannerLinkType;
  linkProductId: bigint | null;
  linkStoreId: bigint | null;
  linkCategoryId: bigint | null;
  linkUrl: string | null;
}

/**
 * 플랫폼 배너 관리. 판매자 배너 API에서 이관 — 매장 소속 제한이 없고, 링크 대상은
 * 존재·미삭제만 확인한다(비활성 대상은 허용: 노출 시점에 구매자 쿼리가 거른다).
 */
@Injectable()
export class AdminBannerService extends AdminBaseService {
  constructor(
    repo: AdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
  ) {
    super(repo, auditLogs);
  }

  async adminBanners(
    accountId: bigint,
    input?: AdminBannerListInput,
  ): Promise<AdminCursorConnection<AdminBannerOutput>> {
    await this.requireAdminContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseId(input.cursor) : null,
    });
    const filter = {
      placement: input?.placement,
      isActive: input?.isActive,
    };

    const [rows, totalCount] = await Promise.all([
      this.repo.listBanners({ ...filter, ...normalized }),
      this.repo.countBanners(filter),
    ]);

    const paged = nextCursorOf(rows, normalized.limit);
    return {
      items: paged.items.map(toAdminBannerOutput),
      totalCount,
      hasMore: paged.hasMore,
      nextCursor: paged.nextCursor,
    };
  }

  async adminBanner(
    accountId: bigint,
    bannerId: bigint,
  ): Promise<AdminBannerOutput> {
    await this.requireAdminContext(accountId);
    return toAdminBannerOutput(await this.requireBanner(bannerId));
  }

  async adminCreateBanner(
    accountId: bigint,
    input: AdminCreateBannerInput,
  ): Promise<AdminBannerOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const linkType = input.linkType ?? 'NONE';
    this.assertInputLinkFieldsMatch(linkType, input);

    const resolved: BannerLinkValues = {
      linkType,
      linkProductId: input.linkProductId ? parseId(input.linkProductId) : null,
      linkStoreId: input.linkStoreId ? parseId(input.linkStoreId) : null,
      linkCategoryId: input.linkCategoryId
        ? parseId(input.linkCategoryId)
        : null,
      linkUrl: input.linkUrl ?? null,
    };
    await this.validateLinkTarget(resolved);

    const row = await this.repo.createBanner({
      placement: input.placement,
      title: cleanNullableText(input.title, MAX_BANNER_TITLE_LENGTH),
      image_url: cleanRequiredText(input.imageUrl, MAX_URL_LENGTH),
      ...this.buildBannerLinkFields(resolved),
      link_type: linkType,
      starts_at: toDate(input.startsAt) ?? null,
      ends_at: toDate(input.endsAt) ?? null,
      sort_order: input.sortOrder ?? 0,
      is_active: input.isActive ?? true,
    });

    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: null,
      targetType: AuditTargetType.BANNER,
      targetId: row.id,
      action: AuditActionType.CREATE,
      afterJson: this.auditSnapshot(row),
    });

    return toAdminBannerOutput(row);
  }

  async adminUpdateBanner(
    accountId: bigint,
    input: AdminUpdateBannerInput,
  ): Promise<AdminBannerOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const current = await this.requireBanner(parseId(input.bannerId));

    const intendedLinkType = input.linkType ?? current.link_type;
    // input 기준으로만 검증한다 — resolved 기준이면 STORE→NONE 같은 정상 변경에서
    // current 잔여값 때문에 false positive가 난다.
    this.assertInputLinkFieldsMatch(intendedLinkType, input);

    const resolved = this.resolveNextLinkValues(input, current);
    await this.validateLinkTarget(resolved);

    const row = await this.repo.updateBanner({
      bannerId: current.id,
      data: this.buildBannerUpdateData(input, resolved),
    });

    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: null,
      targetType: AuditTargetType.BANNER,
      targetId: row.id,
      action: AuditActionType.UPDATE,
      beforeJson: this.auditSnapshot(current),
      afterJson: this.auditSnapshot(row),
    });

    return toAdminBannerOutput(row);
  }

  async adminDeleteBanner(
    accountId: bigint,
    bannerId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireAdminContext(accountId);
    const current = await this.requireBanner(bannerId);

    await this.repo.softDeleteBanner(current.id);
    await this.auditLogs.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: null,
      targetType: AuditTargetType.BANNER,
      targetId: current.id,
      action: AuditActionType.DELETE,
      beforeJson: this.auditSnapshot(current),
    });

    return true;
  }

  private async requireBanner(bannerId: bigint): Promise<Banner> {
    const row = await this.repo.findBannerById(bannerId);
    if (!row) throw new NotFoundException(BANNER_NOT_FOUND);
    return row;
  }

  private auditSnapshot(row: Banner): Prisma.InputJsonValue {
    return {
      placement: row.placement,
      linkType: row.link_type,
      isActive: row.is_active,
      sortOrder: row.sort_order,
    };
  }

  private resolveNextLinkValues(
    input: AdminUpdateBannerInput,
    current: Banner,
  ): BannerLinkValues {
    return {
      linkType: input.linkType ?? current.link_type,
      linkProductId:
        input.linkProductId !== undefined
          ? input.linkProductId
            ? parseId(input.linkProductId)
            : null
          : current.link_product_id,
      linkStoreId:
        input.linkStoreId !== undefined
          ? input.linkStoreId
            ? parseId(input.linkStoreId)
            : null
          : current.link_store_id,
      linkCategoryId:
        input.linkCategoryId !== undefined
          ? input.linkCategoryId
            ? parseId(input.linkCategoryId)
            : null
          : current.link_category_id,
      linkUrl: input.linkUrl !== undefined ? input.linkUrl : current.link_url,
    };
  }

  private buildBannerUpdateData(
    input: AdminUpdateBannerInput,
    resolved: BannerLinkValues,
  ): Prisma.BannerUpdateInput {
    return {
      ...(input.placement !== undefined ? { placement: input.placement } : {}),
      ...(input.title !== undefined
        ? { title: cleanNullableText(input.title, MAX_BANNER_TITLE_LENGTH) }
        : {}),
      ...(input.imageUrl !== undefined
        ? { image_url: cleanRequiredText(input.imageUrl, MAX_URL_LENGTH) }
        : {}),
      // linkType이 바뀌면 이전 타입의 링크 필드를 null로 정리하고, 아니면 명시된 필드만 반영
      ...(input.linkType !== undefined
        ? {
            link_type: resolved.linkType,
            ...this.buildBannerLinkFields(resolved),
          }
        : {
            ...(input.linkUrl !== undefined
              ? { link_url: cleanNullableText(input.linkUrl, MAX_URL_LENGTH) }
              : {}),
            ...(input.linkProductId !== undefined
              ? { link_product_id: resolved.linkProductId }
              : {}),
            ...(input.linkStoreId !== undefined
              ? { link_store_id: resolved.linkStoreId }
              : {}),
            ...(input.linkCategoryId !== undefined
              ? { link_category_id: resolved.linkCategoryId }
              : {}),
          }),
      ...(input.startsAt !== undefined
        ? { starts_at: toDate(input.startsAt) ?? null }
        : {}),
      ...(input.endsAt !== undefined
        ? { ends_at: toDate(input.endsAt) ?? null }
        : {}),
      ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
      ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
    };
  }

  /** linkType에 따라 활성 링크 필드만 유지하고 나머지는 null로 정리한다. */
  private buildBannerLinkFields(resolved: BannerLinkValues): {
    link_url: string | null;
    link_product_id: bigint | null;
    link_store_id: bigint | null;
    link_category_id: bigint | null;
  } {
    const empty = {
      link_url: null,
      link_product_id: null,
      link_store_id: null,
      link_category_id: null,
    };
    switch (resolved.linkType) {
      case 'NONE':
        return empty;
      case 'URL':
        return {
          ...empty,
          link_url: cleanNullableText(resolved.linkUrl, MAX_URL_LENGTH),
        };
      case 'PRODUCT':
        return { ...empty, link_product_id: resolved.linkProductId };
      case 'STORE':
        return { ...empty, link_store_id: resolved.linkStoreId };
      case 'CATEGORY':
        return { ...empty, link_category_id: resolved.linkCategoryId };
    }
  }

  /** linkType이 요구하는 값이 있고, 그 대상이 존재(미삭제)하는지 확인한다. */
  private async validateLinkTarget(args: BannerLinkValues): Promise<void> {
    switch (args.linkType) {
      case 'NONE':
        return;
      case 'URL':
        if (!args.linkUrl || args.linkUrl.trim().length === 0) {
          throw new BadRequestException(LINK_URL_REQUIRED);
        }
        return;
      case 'PRODUCT':
        if (!args.linkProductId) {
          throw new BadRequestException(LINK_PRODUCT_REQUIRED);
        }
        if (!(await this.repo.existsProduct(args.linkProductId))) {
          throw new NotFoundException(LINK_PRODUCT_NOT_FOUND);
        }
        return;
      case 'STORE':
        if (!args.linkStoreId) {
          throw new BadRequestException(LINK_STORE_REQUIRED);
        }
        if (!(await this.repo.existsStore(args.linkStoreId))) {
          throw new NotFoundException(LINK_STORE_NOT_FOUND);
        }
        return;
      case 'CATEGORY':
        if (!args.linkCategoryId) {
          throw new BadRequestException(LINK_CATEGORY_REQUIRED);
        }
        if (!(await this.repo.existsCategory(args.linkCategoryId))) {
          throw new NotFoundException(LINK_CATEGORY_NOT_FOUND);
        }
        return;
    }
  }

  /**
   * intendedLinkType과 무관한 링크 필드가 입력에 섞였는지 검증한다.
   * 깨진 row(linkType=STORE인데 link_product_id가 set)를 fail-fast로 거부한다.
   * null/undefined는 "set 의도 없음", 빈 문자열은 falsy로 통과.
   */
  private assertInputLinkFieldsMatch(
    intendedLinkType: BannerLinkType,
    input: {
      linkUrl?: string | null;
      linkProductId?: string | null;
      linkStoreId?: string | null;
      linkCategoryId?: string | null;
    },
  ): void {
    const hasUrl = !!input.linkUrl && input.linkUrl.trim().length > 0;
    const hasProduct = !!input.linkProductId;
    const hasStore = !!input.linkStoreId;
    const hasCategory = !!input.linkCategoryId;

    const allowed: Record<BannerLinkType, boolean> = {
      NONE: !hasUrl && !hasProduct && !hasStore && !hasCategory,
      URL: !hasProduct && !hasStore && !hasCategory,
      PRODUCT: !hasUrl && !hasStore && !hasCategory,
      STORE: !hasUrl && !hasProduct && !hasCategory,
      CATEGORY: !hasUrl && !hasProduct && !hasStore,
    };

    if (!allowed[intendedLinkType]) {
      throw new BadRequestException(LINK_FIELDS_MISMATCH);
    }
  }
}
