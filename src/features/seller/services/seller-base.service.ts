import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuditTargetType,
  BannerLinkType,
  BannerPlacement,
  ConversationBodyFormat,
  OrderStatus,
  Prisma,
} from '@prisma/client';

import {
  isSellerAccount,
  SellerRepository,
} from '../repositories/seller.repository';
import type {
  SellerAuditLogOutput,
  SellerBannerOutput,
  SellerConversationMessageOutput,
  SellerConversationOutput,
  SellerCustomTemplateOutput,
  SellerCustomTextTokenOutput,
  SellerFaqTopicOutput,
  SellerOptionGroupOutput,
  SellerOptionItemOutput,
  SellerOrderDetailOutput,
  SellerOrderSummaryOutput,
  SellerProductImageOutput,
  SellerProductOutput,
  SellerStoreBusinessHourOutput,
  SellerStoreDailyCapacityOutput,
  SellerStoreOutput,
  SellerStoreSpecialClosureOutput,
} from '../types/seller-output.type';

export interface SellerContext {
  accountId: bigint;
  storeId: bigint;
}

export abstract class SellerBaseService {
  protected constructor(protected readonly repo: SellerRepository) {}
  protected async requireSellerContext(
    accountId: bigint,
  ): Promise<SellerContext> {
    const account = await this.repo.findSellerAccountContext(accountId);
    if (!account) throw new UnauthorizedException('Account not found.');
    if (!isSellerAccount(account.account_type)) {
      throw new ForbiddenException('Only SELLER account is allowed.');
    }
    if (!account.store) {
      throw new NotFoundException('Store not found.');
    }

    return {
      accountId: account.id,
      storeId: account.store.id,
    };
  }

  protected async validateBannerOwnership(
    ctx: SellerContext,
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
      throw new BadRequestException(
        'linkUrl is required when linkType is URL.',
      );
    }

    if (args.linkType === 'PRODUCT') {
      if (!args.linkProductId) {
        throw new BadRequestException(
          'linkProductId is required when linkType is PRODUCT.',
        );
      }
      const product = await this.repo.findProductOwnership({
        productId: args.linkProductId,
        storeId: ctx.storeId,
      });
      if (!product)
        throw new ForbiddenException('Cannot link product outside your store.');
    }

    if (args.linkType === 'STORE') {
      if (!args.linkStoreId) {
        throw new BadRequestException(
          'linkStoreId is required when linkType is STORE.',
        );
      }
      if (args.linkStoreId !== ctx.storeId) {
        throw new ForbiddenException('Cannot link another store.');
      }
    }

    if (args.linkType === 'CATEGORY' && !args.linkCategoryId) {
      throw new BadRequestException(
        'linkCategoryId is required when linkType is CATEGORY.',
      );
    }
  }

  protected assertOrderStatusTransition(
    from: OrderStatus,
    to: OrderStatus,
  ): void {
    if (from === to) {
      throw new BadRequestException('Order status is already set to target.');
    }

    if (to === OrderStatus.CONFIRMED && from !== OrderStatus.SUBMITTED) {
      throw new BadRequestException('Invalid order status transition.');
    }

    if (to === OrderStatus.MADE && from !== OrderStatus.CONFIRMED) {
      throw new BadRequestException('Invalid order status transition.');
    }

    if (to === OrderStatus.PICKED_UP && from !== OrderStatus.MADE) {
      throw new BadRequestException('Invalid order status transition.');
    }

    if (to === OrderStatus.CANCELED) {
      const cancellable =
        from === OrderStatus.SUBMITTED ||
        from === OrderStatus.CONFIRMED ||
        from === OrderStatus.MADE;
      if (!cancellable) {
        throw new BadRequestException(
          'Order cannot be canceled from current status.',
        );
      }
    }
  }

  protected toOrderStatus(raw: string): OrderStatus {
    if (raw === 'SUBMITTED') return OrderStatus.SUBMITTED;
    if (raw === 'CONFIRMED') return OrderStatus.CONFIRMED;
    if (raw === 'MADE') return OrderStatus.MADE;
    if (raw === 'PICKED_UP') return OrderStatus.PICKED_UP;
    if (raw === 'CANCELED') return OrderStatus.CANCELED;
    throw new BadRequestException('Invalid order status.');
  }

  protected toConversationBodyFormat(raw: string): ConversationBodyFormat {
    if (raw === 'TEXT') return ConversationBodyFormat.TEXT;
    if (raw === 'HTML') return ConversationBodyFormat.HTML;
    throw new BadRequestException('Invalid body format.');
  }

  protected toBannerPlacement(raw: string): BannerPlacement {
    if (raw === 'HOME_MAIN') return BannerPlacement.HOME_MAIN;
    if (raw === 'HOME_SUB') return BannerPlacement.HOME_SUB;
    if (raw === 'CATEGORY') return BannerPlacement.CATEGORY;
    if (raw === 'STORE') return BannerPlacement.STORE;
    throw new BadRequestException('Invalid banner placement.');
  }

  protected toBannerLinkType(raw: string): BannerLinkType {
    if (raw === 'NONE') return BannerLinkType.NONE;
    if (raw === 'URL') return BannerLinkType.URL;
    if (raw === 'PRODUCT') return BannerLinkType.PRODUCT;
    if (raw === 'STORE') return BannerLinkType.STORE;
    if (raw === 'CATEGORY') return BannerLinkType.CATEGORY;
    throw new BadRequestException('Invalid banner link type.');
  }

  protected toAuditTargetType(raw: string): AuditTargetType {
    if (raw === 'STORE') return AuditTargetType.STORE;
    if (raw === 'PRODUCT') return AuditTargetType.PRODUCT;
    if (raw === 'ORDER') return AuditTargetType.ORDER;
    if (raw === 'CONVERSATION') return AuditTargetType.CONVERSATION;
    if (raw === 'CHANGE_PASSWORD') return AuditTargetType.CHANGE_PASSWORD;
    throw new BadRequestException('Invalid audit target type.');
  }

  protected parseId(raw: string): bigint {
    try {
      return BigInt(raw);
    } catch {
      throw new BadRequestException('Invalid id.');
    }
  }

  protected parseIdList(rawIds: string[]): bigint[] {
    const parsed = rawIds.map((id) => this.parseId(id));
    const set = new Set(parsed.map((id) => id.toString()));
    if (set.size !== parsed.length) {
      throw new BadRequestException('Duplicate ids are not allowed.');
    }
    return parsed;
  }

  protected toDate(raw?: Date | string | null): Date | undefined {
    if (raw === undefined || raw === null) return undefined;
    const date = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date value.');
    }
    return date;
  }

  protected toDateRequired(raw: Date | string, field: string): Date {
    const date = this.toDate(raw);
    if (!date) throw new BadRequestException(`${field} is required.`);
    return date;
  }

  protected toTime(raw?: Date | string | null): Date | null {
    if (raw === undefined || raw === null) return null;
    const date = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid time value.');
    }
    return date;
  }

  protected toDecimal(raw?: string | null): Prisma.Decimal | null {
    if (raw === undefined || raw === null) return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    try {
      return new Prisma.Decimal(trimmed);
    } catch {
      throw new BadRequestException('Invalid decimal value.');
    }
  }

  protected cleanRequiredText(raw: string, maxLength: number): string {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException('Required text is empty.');
    }
    if (trimmed.length > maxLength) {
      throw new BadRequestException(`Text exceeds ${maxLength} length.`);
    }
    return trimmed;
  }

  protected cleanNullableText(
    raw: string | null | undefined,
    maxLength: number,
  ): string | null {
    if (raw === undefined || raw === null) return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > maxLength) {
      throw new BadRequestException(`Text exceeds ${maxLength} length.`);
    }
    return trimmed;
  }

  protected cleanCurrency(raw?: string | null): string {
    const value = (raw ?? 'KRW').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(value)) {
      throw new BadRequestException('Invalid currency format.');
    }
    return value;
  }

  protected assertPositiveRange(
    value: number,
    min: number,
    max: number,
    field: string,
  ): void {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new BadRequestException(`${field} must be ${min}~${max}.`);
    }
  }

  protected toStoreOutput(row: {
    id: bigint;
    seller_account_id: bigint;
    store_name: string;
    store_phone: string;
    address_full: string;
    address_city: string | null;
    address_district: string | null;
    address_neighborhood: string | null;
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
    map_provider: 'NAVER' | 'KAKAO' | 'NONE';
    website_url: string | null;
    business_hours_text: string | null;
    pickup_slot_interval_minutes: number;
    min_lead_time_minutes: number;
    max_days_ahead: number;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }): SellerStoreOutput {
    return {
      id: row.id.toString(),
      sellerAccountId: row.seller_account_id.toString(),
      storeName: row.store_name,
      storePhone: row.store_phone,
      addressFull: row.address_full,
      addressCity: row.address_city,
      addressDistrict: row.address_district,
      addressNeighborhood: row.address_neighborhood,
      latitude: row.latitude?.toString() ?? null,
      longitude: row.longitude?.toString() ?? null,
      mapProvider: row.map_provider,
      websiteUrl: row.website_url,
      businessHoursText: row.business_hours_text,
      pickupSlotIntervalMinutes: row.pickup_slot_interval_minutes,
      minLeadTimeMinutes: row.min_lead_time_minutes,
      maxDaysAhead: row.max_days_ahead,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  protected toStoreBusinessHourOutput(row: {
    id: bigint;
    day_of_week: number;
    is_closed: boolean;
    open_time: Date | null;
    close_time: Date | null;
    created_at: Date;
    updated_at: Date;
  }): SellerStoreBusinessHourOutput {
    return {
      id: row.id.toString(),
      dayOfWeek: row.day_of_week,
      isClosed: row.is_closed,
      openTime: row.open_time,
      closeTime: row.close_time,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  protected toStoreSpecialClosureOutput(row: {
    id: bigint;
    closure_date: Date;
    reason: string | null;
    created_at: Date;
    updated_at: Date;
  }): SellerStoreSpecialClosureOutput {
    return {
      id: row.id.toString(),
      closureDate: row.closure_date,
      reason: row.reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  protected toStoreDailyCapacityOutput(row: {
    id: bigint;
    capacity_date: Date;
    capacity: number;
    created_at: Date;
    updated_at: Date;
  }): SellerStoreDailyCapacityOutput {
    return {
      id: row.id.toString(),
      capacityDate: row.capacity_date,
      capacity: row.capacity,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  protected toProductOutput(row: {
    id: bigint;
    store_id: bigint;
    name: string;
    description: string | null;
    purchase_notice: string | null;
    regular_price: number;
    sale_price: number | null;
    currency: string;
    base_design_image_url: string | null;
    preparation_time_minutes: number;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
    images: { id: bigint; image_url: string; sort_order: number }[];
    product_categories: { category: { id: bigint; name: string } }[];
    product_tags: { tag: { id: bigint; name: string } }[];
    option_groups: {
      id: bigint;
      product_id: bigint;
      name: string;
      is_required: boolean;
      min_select: number;
      max_select: number;
      option_requires_description: boolean;
      option_requires_image: boolean;
      sort_order: number;
      is_active: boolean;
      option_items: {
        id: bigint;
        option_group_id: bigint;
        title: string;
        description: string | null;
        image_url: string | null;
        price_delta: number;
        sort_order: number;
        is_active: boolean;
      }[];
    }[];
    custom_template: {
      id: bigint;
      product_id: bigint;
      base_image_url: string;
      is_active: boolean;
      text_tokens: {
        id: bigint;
        template_id: bigint;
        token_key: string;
        default_text: string;
        max_length: number;
        sort_order: number;
        is_required: boolean;
        pos_x: number | null;
        pos_y: number | null;
        width: number | null;
        height: number | null;
      }[];
    } | null;
  }): SellerProductOutput {
    return {
      id: row.id.toString(),
      storeId: row.store_id.toString(),
      name: row.name,
      description: row.description,
      purchaseNotice: row.purchase_notice,
      regularPrice: row.regular_price,
      salePrice: row.sale_price,
      currency: row.currency,
      baseDesignImageUrl: row.base_design_image_url,
      preparationTimeMinutes: row.preparation_time_minutes,
      isActive: row.is_active,
      images: row.images.map((image) => this.toProductImageOutput(image)),
      categories: row.product_categories.map((c) => ({
        id: c.category.id.toString(),
        name: c.category.name,
      })),
      tags: row.product_tags.map((t) => ({
        id: t.tag.id.toString(),
        name: t.tag.name,
      })),
      optionGroups: row.option_groups.map((g) => this.toOptionGroupOutput(g)),
      customTemplate: row.custom_template
        ? this.toCustomTemplateOutput(row.custom_template)
        : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  protected toProductImageOutput(row: {
    id: bigint;
    image_url: string;
    sort_order: number;
  }): SellerProductImageOutput {
    return {
      id: row.id.toString(),
      imageUrl: row.image_url,
      sortOrder: row.sort_order,
    };
  }

  protected toOptionGroupOutput(row: {
    id: bigint;
    product_id: bigint;
    name: string;
    is_required: boolean;
    min_select: number;
    max_select: number;
    option_requires_description: boolean;
    option_requires_image: boolean;
    sort_order: number;
    is_active: boolean;
    option_items: {
      id: bigint;
      option_group_id: bigint;
      title: string;
      description: string | null;
      image_url: string | null;
      price_delta: number;
      sort_order: number;
      is_active: boolean;
    }[];
  }): SellerOptionGroupOutput {
    return {
      id: row.id.toString(),
      productId: row.product_id.toString(),
      name: row.name,
      isRequired: row.is_required,
      minSelect: row.min_select,
      maxSelect: row.max_select,
      optionRequiresDescription: row.option_requires_description,
      optionRequiresImage: row.option_requires_image,
      sortOrder: row.sort_order,
      isActive: row.is_active,
      optionItems: row.option_items.map((item) =>
        this.toOptionItemOutput(item),
      ),
    };
  }

  protected toOptionItemOutput(row: {
    id: bigint;
    option_group_id: bigint;
    title: string;
    description: string | null;
    image_url: string | null;
    price_delta: number;
    sort_order: number;
    is_active: boolean;
  }): SellerOptionItemOutput {
    return {
      id: row.id.toString(),
      optionGroupId: row.option_group_id.toString(),
      title: row.title,
      description: row.description,
      imageUrl: row.image_url,
      priceDelta: row.price_delta,
      sortOrder: row.sort_order,
      isActive: row.is_active,
    };
  }

  protected toCustomTemplateOutput(row: {
    id: bigint;
    product_id: bigint;
    base_image_url: string;
    is_active: boolean;
    text_tokens: {
      id: bigint;
      template_id: bigint;
      token_key: string;
      default_text: string;
      max_length: number;
      sort_order: number;
      is_required: boolean;
      pos_x: number | null;
      pos_y: number | null;
      width: number | null;
      height: number | null;
    }[];
  }): SellerCustomTemplateOutput {
    return {
      id: row.id.toString(),
      productId: row.product_id.toString(),
      baseImageUrl: row.base_image_url,
      isActive: row.is_active,
      textTokens: row.text_tokens.map((token) =>
        this.toCustomTextTokenOutput(token),
      ),
    };
  }

  protected toCustomTextTokenOutput(row: {
    id: bigint;
    template_id: bigint;
    token_key: string;
    default_text: string;
    max_length: number;
    sort_order: number;
    is_required: boolean;
    pos_x: number | null;
    pos_y: number | null;
    width: number | null;
    height: number | null;
  }): SellerCustomTextTokenOutput {
    return {
      id: row.id.toString(),
      templateId: row.template_id.toString(),
      tokenKey: row.token_key,
      defaultText: row.default_text,
      maxLength: row.max_length,
      sortOrder: row.sort_order,
      isRequired: row.is_required,
      posX: row.pos_x,
      posY: row.pos_y,
      width: row.width,
      height: row.height,
    };
  }

  protected toOrderSummaryOutput(row: {
    id: bigint;
    order_number: string;
    status: OrderStatus;
    pickup_at: Date;
    buyer_name: string;
    buyer_phone: string;
    total_price: number;
    created_at: Date;
  }): SellerOrderSummaryOutput {
    return {
      id: row.id.toString(),
      orderNumber: row.order_number,
      status: row.status,
      pickupAt: row.pickup_at,
      buyerName: row.buyer_name,
      buyerPhone: row.buyer_phone,
      totalPrice: row.total_price,
      createdAt: row.created_at,
    };
  }

  protected toOrderDetailOutput(row: {
    id: bigint;
    order_number: string;
    account_id: bigint;
    status: OrderStatus;
    pickup_at: Date;
    buyer_name: string;
    buyer_phone: string;
    subtotal_price: number;
    discount_price: number;
    total_price: number;
    submitted_at: Date | null;
    confirmed_at: Date | null;
    made_at: Date | null;
    picked_up_at: Date | null;
    canceled_at: Date | null;
    created_at: Date;
    updated_at: Date;
    status_histories: {
      id: bigint;
      from_status: OrderStatus | null;
      to_status: OrderStatus;
      changed_at: Date;
      note: string | null;
    }[];
    items: {
      id: bigint;
      store_id: bigint;
      product_id: bigint;
      product_name_snapshot: string;
      regular_price_snapshot: number;
      sale_price_snapshot: number | null;
      quantity: number;
      item_subtotal_price: number;
      option_items: {
        id: bigint;
        group_name_snapshot: string;
        option_title_snapshot: string;
        option_price_delta_snapshot: number;
      }[];
      custom_texts: {
        id: bigint;
        token_key_snapshot: string;
        default_text_snapshot: string;
        value_text: string;
        sort_order: number;
      }[];
      free_edits: {
        id: bigint;
        crop_image_url: string;
        description_text: string;
        sort_order: number;
        attachments: { id: bigint; image_url: string; sort_order: number }[];
      }[];
    }[];
  }): SellerOrderDetailOutput {
    return {
      id: row.id.toString(),
      orderNumber: row.order_number,
      accountId: row.account_id.toString(),
      status: row.status,
      pickupAt: row.pickup_at,
      buyerName: row.buyer_name,
      buyerPhone: row.buyer_phone,
      subtotalPrice: row.subtotal_price,
      discountPrice: row.discount_price,
      totalPrice: row.total_price,
      submittedAt: row.submitted_at,
      confirmedAt: row.confirmed_at,
      madeAt: row.made_at,
      pickedUpAt: row.picked_up_at,
      canceledAt: row.canceled_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      items: row.items.map((item) => ({
        id: item.id.toString(),
        storeId: item.store_id.toString(),
        productId: item.product_id.toString(),
        productNameSnapshot: item.product_name_snapshot,
        regularPriceSnapshot: item.regular_price_snapshot,
        salePriceSnapshot: item.sale_price_snapshot,
        quantity: item.quantity,
        itemSubtotalPrice: item.item_subtotal_price,
        optionItems: item.option_items.map((opt) => ({
          id: opt.id.toString(),
          groupNameSnapshot: opt.group_name_snapshot,
          optionTitleSnapshot: opt.option_title_snapshot,
          optionPriceDeltaSnapshot: opt.option_price_delta_snapshot,
        })),
        customTexts: item.custom_texts.map((text) => ({
          id: text.id.toString(),
          tokenKeySnapshot: text.token_key_snapshot,
          defaultTextSnapshot: text.default_text_snapshot,
          valueText: text.value_text,
          sortOrder: text.sort_order,
        })),
        freeEdits: item.free_edits.map((edit) => ({
          id: edit.id.toString(),
          cropImageUrl: edit.crop_image_url,
          descriptionText: edit.description_text,
          sortOrder: edit.sort_order,
          attachments: edit.attachments.map((attachment) => ({
            id: attachment.id.toString(),
            imageUrl: attachment.image_url,
            sortOrder: attachment.sort_order,
          })),
        })),
      })),
      statusHistories: row.status_histories.map((history) => ({
        id: history.id.toString(),
        fromStatus: history.from_status,
        toStatus: history.to_status,
        changedAt: history.changed_at,
        note: history.note,
      })),
    };
  }

  protected toConversationOutput(row: {
    id: bigint;
    account_id: bigint;
    store_id: bigint;
    last_message_at: Date | null;
    last_read_at: Date | null;
    updated_at: Date;
  }): SellerConversationOutput {
    return {
      id: row.id.toString(),
      accountId: row.account_id.toString(),
      storeId: row.store_id.toString(),
      lastMessageAt: row.last_message_at,
      lastReadAt: row.last_read_at,
      updatedAt: row.updated_at,
    };
  }

  protected toConversationMessageOutput(row: {
    id: bigint;
    conversation_id: bigint;
    sender_type: 'USER' | 'STORE' | 'SYSTEM';
    sender_account_id: bigint | null;
    body_format: 'TEXT' | 'HTML';
    body_text: string | null;
    body_html: string | null;
    created_at: Date;
  }): SellerConversationMessageOutput {
    return {
      id: row.id.toString(),
      conversationId: row.conversation_id.toString(),
      senderType: row.sender_type,
      senderAccountId: row.sender_account_id?.toString() ?? null,
      bodyFormat: row.body_format,
      bodyText: row.body_text,
      bodyHtml: row.body_html,
      createdAt: row.created_at,
    };
  }

  protected toFaqTopicOutput(row: {
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

  protected toBannerOutput(row: {
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

  protected toAuditLogOutput(row: {
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
