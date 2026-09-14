import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { toDate } from '@/common/utils/date-parser';
import { parseId } from '@/common/utils/id-parser';
import {
  sliceIdCursorPage,
  normalizeCursorInput,
} from '@/common/utils/pagination';
import {
  cleanNullableText,
  cleanRequiredText,
} from '@/common/utils/text-cleaner';
import {
  BANNER_NOT_FOUND,
  CATEGORY_PLACEMENT_REQUIRES_CATEGORY_LINK,
  CATEGORY_PLACEMENT_REQUIRES_EVENT_CATEGORY,
  INVALID_EXPOSURE_WINDOW,
  LINK_CATEGORY_NOT_VISIBLE,
  LINK_CATEGORY_REQUIRED,
  LINK_FIELDS_MISMATCH,
  LINK_PRODUCT_NOT_VISIBLE,
  LINK_PRODUCT_REQUIRED,
  LINK_STORE_NOT_VISIBLE,
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
import {
  AuditActionType,
  AuditTargetType,
  type Banner,
  type BannerLinkType,
  type BannerPlacement,
  type Prisma,
} from '@/generated/prisma/client';
import { S3Service } from '@/global/storage/s3.service';

/** linkType이 결정된 뒤의 링크 값 묶음. 생성·수정이 같은 검증을 탄다. */
interface BannerLinkValues {
  linkType: BannerLinkType;
  linkProductId: bigint | null;
  linkStoreId: bigint | null;
  linkCategoryId: bigint | null;
  linkUrl: string | null;
}

/** 저장 직전의 최종 노출 조건. 생성은 입력 그대로, 수정은 현재 값과 병합한 결과다. */
interface BannerExposure extends BannerLinkValues {
  placement: BannerPlacement;
  startsAt: Date | null;
  endsAt: Date | null;
}

/**
 * 플랫폼 배너 관리. 판매자 배너 API에서 이관 — 매장 소속 제한이 없다.
 * 저장 시점에 "구매자 조회(findFirstBanner)가 뽑을 수 있는 상태"인지 확인한다 —
 * 링크 대상 노출 가능(visibleWhere), CATEGORY 지면은 EVENT 카테고리 링크, 노출 기간 순서.
 * 저장 후 대상이 내려가는 건 노출 시점에 구매자 쿼리가 거른다.
 */
@Injectable()
export class AdminBannerService extends AdminBaseService {
  constructor(
    repo: AdminRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    auditLogs: IAuditLogRepository,
    private readonly s3Service: S3Service,
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

    const paged = sliceIdCursorPage(rows, normalized.limit);
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

    // 발급받은 배너 이미지 URL만 저장한다 — 외부 링크·타인 key 차단.
    this.s3Service.assertOwnedUploadUrl(
      input.imageUrl,
      'BANNER_IMAGE',
      accountId,
    );

    const resolved: BannerLinkValues = {
      linkType,
      linkProductId: input.linkProductId ? parseId(input.linkProductId) : null,
      linkStoreId: input.linkStoreId ? parseId(input.linkStoreId) : null,
      linkCategoryId: input.linkCategoryId
        ? parseId(input.linkCategoryId)
        : null,
      linkUrl: input.linkUrl ?? null,
    };
    const exposure: BannerExposure = {
      ...resolved,
      placement: input.placement,
      startsAt: toDate(input.startsAt) ?? null,
      endsAt: toDate(input.endsAt) ?? null,
    };
    await this.validateExposure(exposure);

    const row = await this.repo.createBanner(
      {
        placement: exposure.placement,
        title: cleanNullableText(input.title, MAX_BANNER_TITLE_LENGTH),
        image_url: cleanRequiredText(input.imageUrl, MAX_URL_LENGTH),
        ...this.buildBannerLinkFields(resolved),
        link_type: linkType,
        starts_at: exposure.startsAt,
        ends_at: exposure.endsAt,
        sort_order: input.sortOrder ?? 0,
        is_active: input.isActive ?? true,
      },
      (created) => ({
        actorAccountId: ctx.accountId,
        storeId: null,
        targetType: AuditTargetType.BANNER,
        targetId: created.id,
        action: AuditActionType.CREATE,
        afterJson: this.auditSnapshot(created),
      }),
    );

    return toAdminBannerOutput(row);
  }

  async adminUpdateBanner(
    accountId: bigint,
    input: AdminUpdateBannerInput,
  ): Promise<AdminBannerOutput> {
    const ctx = await this.requireAdminContext(accountId);
    const current = await this.requireBanner(parseId(input.bannerId));

    this.s3Service.assertOwnedUploadUrlIfPresent(
      input.imageUrl,
      'BANNER_IMAGE',
      accountId,
    );

    const intendedLinkType = input.linkType ?? current.link_type;
    // input 기준으로만 검증한다 — resolved 기준이면 STORE→NONE 같은 정상 변경에서
    // current 잔여값 때문에 false positive가 난다.
    this.assertInputLinkFieldsMatch(intendedLinkType, input);

    const resolved = this.resolveNextLinkValues(input, current);
    // 병합된 최종 상태로 검증한다 — 입력만 보면 기존 값과 조합해 노출 불가 상태가 될 수 있다
    await this.validateExposure({
      ...resolved,
      placement: input.placement ?? current.placement,
      startsAt:
        input.startsAt !== undefined
          ? (toDate(input.startsAt) ?? null)
          : current.starts_at,
      endsAt:
        input.endsAt !== undefined
          ? (toDate(input.endsAt) ?? null)
          : current.ends_at,
    });

    // before는 repository가 잠금 뒤 트랜잭션 안에서 읽는다 — current는 검증용일 뿐 감사엔 안 쓴다
    const row = await this.repo.updateBanner(
      {
        bannerId: current.id,
        data: this.buildBannerUpdateData(input, resolved),
      },
      (before, after) => ({
        actorAccountId: ctx.accountId,
        storeId: null,
        targetType: AuditTargetType.BANNER,
        targetId: after.id,
        action: AuditActionType.UPDATE,
        beforeJson: this.auditSnapshot(before),
        afterJson: this.auditSnapshot(after),
      }),
    );
    if (!row) throw new NotFoundException(BANNER_NOT_FOUND);

    return toAdminBannerOutput(row);
  }

  async adminDeleteBanner(
    accountId: bigint,
    bannerId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireAdminContext(accountId);

    const deleted = await this.repo.softDeleteBanner(bannerId, (before) => ({
      actorAccountId: ctx.accountId,
      storeId: null,
      targetType: AuditTargetType.BANNER,
      targetId: before.id,
      action: AuditActionType.DELETE,
      beforeJson: this.auditSnapshot(before),
    }));
    if (!deleted) throw new NotFoundException(BANNER_NOT_FOUND);

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

  /**
   * 저장하려는 최종 상태가 구매자 조회에서 뽑힐 수 있는지 확인한다.
   * - 노출 기간: startsAt < endsAt (둘 다 있을 때)
   * - 링크 대상: findFirstBanner와 같은 visibleWhere 기준(활성·미삭제, 상품은 매장까지)
   * - CATEGORY 지면: 홈 칩 배너는 EVENT 카테고리 링크로만 뽑히므로 linkType CATEGORY + EVENT 필수
   */
  private async validateExposure(final: BannerExposure): Promise<void> {
    if (final.startsAt && final.endsAt && final.startsAt >= final.endsAt) {
      throw new BadRequestException(INVALID_EXPOSURE_WINDOW);
    }
    if (final.placement === 'CATEGORY' && final.linkType !== 'CATEGORY') {
      throw new BadRequestException(CATEGORY_PLACEMENT_REQUIRES_CATEGORY_LINK);
    }

    switch (final.linkType) {
      case 'NONE':
        return;
      case 'URL':
        if (!final.linkUrl || final.linkUrl.trim().length === 0) {
          throw new BadRequestException(LINK_URL_REQUIRED);
        }
        return;
      case 'PRODUCT':
        if (!final.linkProductId) {
          throw new BadRequestException(LINK_PRODUCT_REQUIRED);
        }
        if (!(await this.repo.isProductVisible(final.linkProductId))) {
          throw new NotFoundException(LINK_PRODUCT_NOT_VISIBLE);
        }
        return;
      case 'STORE':
        if (!final.linkStoreId) {
          throw new BadRequestException(LINK_STORE_REQUIRED);
        }
        if (!(await this.repo.isStoreVisible(final.linkStoreId))) {
          throw new NotFoundException(LINK_STORE_NOT_VISIBLE);
        }
        return;
      case 'CATEGORY': {
        if (!final.linkCategoryId) {
          throw new BadRequestException(LINK_CATEGORY_REQUIRED);
        }
        const categoryType = await this.repo.findVisibleCategoryType(
          final.linkCategoryId,
        );
        if (!categoryType) {
          throw new NotFoundException(LINK_CATEGORY_NOT_VISIBLE);
        }
        if (final.placement === 'CATEGORY' && categoryType !== 'EVENT') {
          throw new BadRequestException(
            CATEGORY_PLACEMENT_REQUIRES_EVENT_CATEGORY,
          );
        }
        return;
      }
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
