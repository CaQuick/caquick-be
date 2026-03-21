import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditActionType,
  AuditTargetType,
  BannerLinkType,
  BannerPlacement,
  Prisma,
} from '@prisma/client';

import { toDate } from '@/common/utils/date-parser';
import { parseId } from '@/common/utils/id-parser';
import {
  cleanNullableText,
  cleanRequiredText,
} from '@/common/utils/text-cleaner';
import { ProductRepository } from '@/features/product';
import {
  BANNER_NOT_FOUND,
  FAQ_TOPIC_NOT_FOUND,
  INVALID_AUDIT_TARGET_TYPE,
  INVALID_BANNER_LINK_TYPE,
  INVALID_BANNER_PLACEMENT,
  LINK_CATEGORY_REQUIRED,
  LINK_PRODUCT_MISMATCH,
  LINK_PRODUCT_REQUIRED,
  LINK_STORE_MISMATCH,
  LINK_STORE_REQUIRED,
  LINK_URL_REQUIRED,
} from '@/features/seller/constants/seller-error-messages';
import {
  MAX_BANNER_TITLE_LENGTH,
  MAX_FAQ_ANSWER_HTML_LENGTH,
  MAX_FAQ_TITLE_LENGTH,
  MAX_URL_LENGTH,
} from '@/features/seller/constants/seller.constants';
import {
  nextCursorOf,
  normalizeCursorInput,
  SellerRepository,
} from '@/features/seller/repositories/seller.repository';
import { SellerBaseService } from '@/features/seller/services/seller-base.service';
import type {
  SellerAuditLogListInput,
  SellerCreateBannerInput,
  SellerCreateFaqTopicInput,
  SellerCursorInput,
  SellerUpdateBannerInput,
  SellerUpdateFaqTopicInput,
} from '@/features/seller/types/seller-input.type';
import type {
  SellerAuditLogOutput,
  SellerBannerOutput,
  SellerCursorConnection,
  SellerFaqTopicOutput,
} from '@/features/seller/types/seller-output.type';

@Injectable()
export class SellerContentService extends SellerBaseService {
  constructor(
    repo: SellerRepository,
    private readonly productRepository: ProductRepository,
  ) {
    super(repo);
  }
  async sellerFaqTopics(accountId: bigint): Promise<SellerFaqTopicOutput[]> {
    const ctx = await this.requireSellerContext(accountId);
    const rows = await this.repo.listFaqTopics(ctx.storeId);
    return rows.map((row) => this.toFaqTopicOutput(row));
  }

  async sellerCreateFaqTopic(
    accountId: bigint,
    input: SellerCreateFaqTopicInput,
  ): Promise<SellerFaqTopicOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const row = await this.repo.createFaqTopic({
      storeId: ctx.storeId,
      title: cleanRequiredText(input.title, MAX_FAQ_TITLE_LENGTH),
      answerHtml: cleanRequiredText(
        input.answerHtml,
        MAX_FAQ_ANSWER_HTML_LENGTH,
      ),
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: AuditActionType.CREATE,
      afterJson: {
        topicId: row.id.toString(),
      },
    });

    return this.toFaqTopicOutput(row);
  }

  async sellerUpdateFaqTopic(
    accountId: bigint,
    input: SellerUpdateFaqTopicInput,
  ): Promise<SellerFaqTopicOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const topicId = parseId(input.topicId);

    const current = await this.repo.findFaqTopicById({
      topicId,
      storeId: ctx.storeId,
    });
    if (!current) throw new NotFoundException(FAQ_TOPIC_NOT_FOUND);

    const row = await this.repo.updateFaqTopic({
      topicId,
      data: {
        ...(input.title !== undefined
          ? { title: cleanRequiredText(input.title, MAX_FAQ_TITLE_LENGTH) }
          : {}),
        ...(input.answerHtml !== undefined
          ? {
              answer_html: cleanRequiredText(
                input.answerHtml,
                MAX_FAQ_ANSWER_HTML_LENGTH,
              ),
            }
          : {}),
        ...(input.sortOrder !== undefined
          ? { sort_order: input.sortOrder }
          : {}),
        ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
      },
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: AuditActionType.UPDATE,
      afterJson: {
        topicId: row.id.toString(),
      },
    });

    return this.toFaqTopicOutput(row);
  }

  async sellerDeleteFaqTopic(
    accountId: bigint,
    topicId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireSellerContext(accountId);
    const current = await this.repo.findFaqTopicById({
      topicId,
      storeId: ctx.storeId,
    });
    if (!current) throw new NotFoundException(FAQ_TOPIC_NOT_FOUND);

    await this.repo.softDeleteFaqTopic(topicId);
    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: AuditActionType.DELETE,
      beforeJson: {
        topicId: current.id.toString(),
      },
    });

    return true;
  }

  async sellerBanners(
    accountId: bigint,
    input?: SellerCursorInput,
  ): Promise<SellerCursorConnection<SellerBannerOutput>> {
    const ctx = await this.requireSellerContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseId(input.cursor) : null,
    });

    const rows = await this.repo.listBannersByStore({
      storeId: ctx.storeId,
      limit: normalized.limit,
      cursor: normalized.cursor,
    });

    const paged = nextCursorOf(rows, normalized.limit);
    return {
      items: paged.items.map((row) => this.toBannerOutput(row)),
      nextCursor: paged.nextCursor,
    };
  }

  async sellerCreateBanner(
    accountId: bigint,
    input: SellerCreateBannerInput,
  ): Promise<SellerBannerOutput> {
    const ctx = await this.requireSellerContext(accountId);
    await this.validateBannerOwnership(ctx, {
      linkType: input.linkType ?? 'NONE',
      linkProductId: input.linkProductId ? parseId(input.linkProductId) : null,
      linkStoreId: input.linkStoreId ? parseId(input.linkStoreId) : null,
      linkCategoryId: input.linkCategoryId
        ? parseId(input.linkCategoryId)
        : null,
      linkUrl: input.linkUrl ?? null,
    });

    const row = await this.repo.createBanner({
      placement: this.toBannerPlacement(input.placement),
      title: cleanNullableText(input.title, MAX_BANNER_TITLE_LENGTH),
      imageUrl: cleanRequiredText(input.imageUrl, MAX_URL_LENGTH),
      linkType: this.toBannerLinkType(input.linkType ?? 'NONE'),
      linkUrl: cleanNullableText(input.linkUrl, MAX_URL_LENGTH),
      linkProductId: input.linkProductId ? parseId(input.linkProductId) : null,
      linkStoreId: input.linkStoreId ? parseId(input.linkStoreId) : null,
      linkCategoryId: input.linkCategoryId
        ? parseId(input.linkCategoryId)
        : null,
      startsAt: toDate(input.startsAt) ?? null,
      endsAt: toDate(input.endsAt) ?? null,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: AuditActionType.CREATE,
      afterJson: {
        bannerId: row.id.toString(),
      },
    });

    return this.toBannerOutput(row);
  }

  async sellerUpdateBanner(
    accountId: bigint,
    input: SellerUpdateBannerInput,
  ): Promise<SellerBannerOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const bannerId = parseId(input.bannerId);

    const current = await this.repo.findBannerByIdForStore({
      bannerId,
      storeId: ctx.storeId,
    });
    if (!current) throw new NotFoundException(BANNER_NOT_FOUND);

    const resolved = this.resolveNextBannerLinkValues(input, current);
    await this.validateBannerOwnership(ctx, resolved);

    const data = this.buildBannerUpdateData(input, resolved);
    const row = await this.repo.updateBanner({ bannerId, data });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: AuditActionType.UPDATE,
      afterJson: {
        bannerId: row.id.toString(),
      },
    });

    return this.toBannerOutput(row);
  }

  private resolveNextBannerLinkValues(
    input: SellerUpdateBannerInput,
    current: {
      link_type: string;
      link_product_id: bigint | null;
      link_store_id: bigint | null;
      link_category_id: bigint | null;
      link_url: string | null;
    },
  ) {
    return {
      linkType: (input.linkType ?? current.link_type) as
        | 'NONE'
        | 'URL'
        | 'PRODUCT'
        | 'STORE'
        | 'CATEGORY',
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
    input: SellerUpdateBannerInput,
    resolved: ReturnType<typeof this.resolveNextBannerLinkValues>,
  ) {
    const linkFieldsForType = this.buildBannerLinkFields(resolved);

    return {
      ...(input.placement !== undefined
        ? { placement: this.toBannerPlacement(input.placement) }
        : {}),
      ...(input.title !== undefined
        ? {
            title: cleanNullableText(input.title, MAX_BANNER_TITLE_LENGTH),
          }
        : {}),
      ...(input.imageUrl !== undefined
        ? {
            image_url: cleanRequiredText(input.imageUrl, MAX_URL_LENGTH),
          }
        : {}),
      // linkType이 변경되면 resolved 기반으로 비활성 링크 필드를 null 처리
      ...(input.linkType !== undefined
        ? {
            link_type: this.toBannerLinkType(input.linkType),
            ...linkFieldsForType,
          }
        : {
            // linkType 미변경 시 input에 명시된 필드만 반영
            ...(input.linkUrl !== undefined
              ? {
                  link_url: cleanNullableText(input.linkUrl, MAX_URL_LENGTH),
                }
              : {}),
            ...(input.linkProductId !== undefined
              ? {
                  link_product_id: input.linkProductId
                    ? parseId(input.linkProductId)
                    : null,
                }
              : {}),
            ...(input.linkStoreId !== undefined
              ? {
                  link_store_id: input.linkStoreId
                    ? parseId(input.linkStoreId)
                    : null,
                }
              : {}),
            ...(input.linkCategoryId !== undefined
              ? {
                  link_category_id: input.linkCategoryId
                    ? parseId(input.linkCategoryId)
                    : null,
                }
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

  /** linkType에 따라 활성 링크 필드만 유지하고, 비활성 필드는 null로 정리 */
  private buildBannerLinkFields(resolved: {
    linkType: 'NONE' | 'URL' | 'PRODUCT' | 'STORE' | 'CATEGORY';
    linkProductId: bigint | null;
    linkStoreId: bigint | null;
    linkCategoryId: bigint | null;
    linkUrl: string | null;
  }) {
    switch (resolved.linkType) {
      case 'NONE':
        return {
          link_url: null,
          link_product_id: null,
          link_store_id: null,
          link_category_id: null,
        };
      case 'URL':
        return {
          link_url: cleanNullableText(resolved.linkUrl, MAX_URL_LENGTH),
          link_product_id: null,
          link_store_id: null,
          link_category_id: null,
        };
      case 'PRODUCT':
        return {
          link_url: null,
          link_product_id: resolved.linkProductId,
          link_store_id: null,
          link_category_id: null,
        };
      case 'STORE':
        return {
          link_url: null,
          link_product_id: null,
          link_store_id: resolved.linkStoreId,
          link_category_id: null,
        };
      case 'CATEGORY':
        return {
          link_url: null,
          link_product_id: null,
          link_store_id: null,
          link_category_id: resolved.linkCategoryId,
        };
    }
  }

  async sellerDeleteBanner(
    accountId: bigint,
    bannerId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireSellerContext(accountId);
    const current = await this.repo.findBannerByIdForStore({
      bannerId,
      storeId: ctx.storeId,
    });
    if (!current) throw new NotFoundException(BANNER_NOT_FOUND);

    await this.repo.softDeleteBanner(bannerId);
    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: AuditActionType.DELETE,
      beforeJson: {
        bannerId: current.id.toString(),
      },
    });

    return true;
  }

  async sellerAuditLogs(
    accountId: bigint,
    input?: SellerAuditLogListInput,
  ): Promise<SellerCursorConnection<SellerAuditLogOutput>> {
    const ctx = await this.requireSellerContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? parseId(input.cursor) : null,
    });

    const rows = await this.repo.listAuditLogsBySeller({
      sellerAccountId: ctx.accountId,
      storeId: ctx.storeId,
      limit: normalized.limit,
      cursor: normalized.cursor,
      targetType: input?.targetType
        ? this.toAuditTargetType(input.targetType)
        : undefined,
    });

    const paged = nextCursorOf(rows, normalized.limit);
    return {
      items: paged.items.map((row) => this.toAuditLogOutput(row)),
      nextCursor: paged.nextCursor,
    };
  }

  private async validateBannerOwnership(
    ctx: { accountId: bigint; storeId: bigint },
    args: {
      linkType: 'NONE' | 'URL' | 'PRODUCT' | 'STORE' | 'CATEGORY';
      linkProductId: bigint | null;
      linkStoreId: bigint | null;
      linkCategoryId: bigint | null;
      linkUrl: string | null;
    },
  ): Promise<void> {
    if (
      args.linkType === 'URL' &&
      (!args.linkUrl || args.linkUrl.trim().length === 0)
    ) {
      throw new BadRequestException(LINK_URL_REQUIRED);
    }

    if (args.linkType === 'PRODUCT') {
      if (!args.linkProductId) {
        throw new BadRequestException(LINK_PRODUCT_REQUIRED);
      }
      const product = await this.productRepository.findProductOwnership({
        productId: args.linkProductId,
        storeId: ctx.storeId,
      });
      if (!product) throw new ForbiddenException(LINK_PRODUCT_MISMATCH);
    }

    if (args.linkType === 'STORE') {
      if (!args.linkStoreId) {
        throw new BadRequestException(LINK_STORE_REQUIRED);
      }
      if (args.linkStoreId !== ctx.storeId) {
        throw new ForbiddenException(LINK_STORE_MISMATCH);
      }
    }

    if (args.linkType === 'CATEGORY' && !args.linkCategoryId) {
      throw new BadRequestException(LINK_CATEGORY_REQUIRED);
    }
  }

  private toBannerPlacement(raw: string): BannerPlacement {
    if (raw === 'HOME_MAIN') return BannerPlacement.HOME_MAIN;
    if (raw === 'HOME_SUB') return BannerPlacement.HOME_SUB;
    if (raw === 'CATEGORY') return BannerPlacement.CATEGORY;
    if (raw === 'STORE') return BannerPlacement.STORE;
    throw new BadRequestException(INVALID_BANNER_PLACEMENT);
  }

  private toBannerLinkType(raw: string): BannerLinkType {
    if (raw === 'NONE') return BannerLinkType.NONE;
    if (raw === 'URL') return BannerLinkType.URL;
    if (raw === 'PRODUCT') return BannerLinkType.PRODUCT;
    if (raw === 'STORE') return BannerLinkType.STORE;
    if (raw === 'CATEGORY') return BannerLinkType.CATEGORY;
    throw new BadRequestException(INVALID_BANNER_LINK_TYPE);
  }

  private toAuditTargetType(raw: string): AuditTargetType {
    if (raw === 'STORE') return AuditTargetType.STORE;
    if (raw === 'PRODUCT') return AuditTargetType.PRODUCT;
    if (raw === 'ORDER') return AuditTargetType.ORDER;
    if (raw === 'CONVERSATION') return AuditTargetType.CONVERSATION;
    if (raw === 'CHANGE_PASSWORD') return AuditTargetType.CHANGE_PASSWORD;
    throw new BadRequestException(INVALID_AUDIT_TARGET_TYPE);
  }

  private toFaqTopicOutput(row: {
    id: bigint;
    store_id: bigint;
    title: string;
    answer_html: string;
    sort_order: number;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }): SellerFaqTopicOutput {
    return {
      id: row.id.toString(),
      storeId: row.store_id.toString(),
      title: row.title,
      answerHtml: row.answer_html,
      sortOrder: row.sort_order,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toBannerOutput(row: {
    id: bigint;
    placement: 'HOME_MAIN' | 'HOME_SUB' | 'CATEGORY' | 'STORE';
    title: string | null;
    image_url: string;
    link_type: 'NONE' | 'URL' | 'PRODUCT' | 'STORE' | 'CATEGORY';
    link_url: string | null;
    link_product_id: bigint | null;
    link_store_id: bigint | null;
    link_category_id: bigint | null;
    starts_at: Date | null;
    ends_at: Date | null;
    sort_order: number;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }): SellerBannerOutput {
    return {
      id: row.id.toString(),
      placement: row.placement,
      title: row.title,
      imageUrl: row.image_url,
      linkType: row.link_type,
      linkUrl: row.link_url,
      linkProductId: row.link_product_id?.toString() ?? null,
      linkStoreId: row.link_store_id?.toString() ?? null,
      linkCategoryId: row.link_category_id?.toString() ?? null,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      sortOrder: row.sort_order,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toAuditLogOutput(row: {
    id: bigint;
    actor_account_id: bigint;
    store_id: bigint | null;
    target_type:
      | 'STORE'
      | 'PRODUCT'
      | 'ORDER'
      | 'CONVERSATION'
      | 'CHANGE_PASSWORD';
    target_id: bigint;
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE';
    before_json: Prisma.JsonValue | null;
    after_json: Prisma.JsonValue | null;
    ip_address: string | null;
    user_agent: string | null;
    created_at: Date;
  }): SellerAuditLogOutput {
    return {
      id: row.id.toString(),
      actorAccountId: row.actor_account_id.toString(),
      storeId: row.store_id?.toString() ?? null,
      targetType: row.target_type,
      targetId: row.target_id.toString(),
      action: row.action,
      beforeJson: row.before_json ? JSON.stringify(row.before_json) : null,
      afterJson: row.after_json ? JSON.stringify(row.after_json) : null,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: row.created_at,
    };
  }
}
