import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuditActionType,
  AuditTargetType,
  BannerLinkType,
  BannerPlacement,
  ConversationBodyFormat,
  OrderStatus,
  Prisma,
} from '@prisma/client';

import {
  isSellerAccount,
  nextCursorOf,
  normalizeCursorInput,
  SellerRepository,
} from './repositories/seller.repository';
import type {
  SellerAddProductImageInput,
  SellerAuditLogListInput,
  SellerCreateBannerInput,
  SellerCreateFaqTopicInput,
  SellerCreateOptionGroupInput,
  SellerCreateOptionItemInput,
  SellerCreateProductInput,
  SellerCursorInput,
  SellerDateCursorInput,
  SellerOrderListInput,
  SellerProductListInput,
  SellerReorderOptionGroupsInput,
  SellerReorderOptionItemsInput,
  SellerReorderProductCustomTextTokensInput,
  SellerReorderProductImagesInput,
  SellerSendConversationMessageInput,
  SellerSetProductActiveInput,
  SellerSetProductCategoriesInput,
  SellerSetProductCustomTemplateActiveInput,
  SellerSetProductTagsInput,
  SellerUpdateBannerInput,
  SellerUpdateFaqTopicInput,
  SellerUpdateOptionGroupInput,
  SellerUpdateOptionItemInput,
  SellerUpdateOrderStatusInput,
  SellerUpdatePickupPolicyInput,
  SellerUpdateProductInput,
  SellerUpdateStoreBasicInfoInput,
  SellerUpsertProductCustomTemplateInput,
  SellerUpsertProductCustomTextTokenInput,
  SellerUpsertStoreBusinessHourInput,
  SellerUpsertStoreDailyCapacityInput,
  SellerUpsertStoreSpecialClosureInput,
} from './types/seller-input.type';
import type {
  SellerAuditLogOutput,
  SellerBannerOutput,
  SellerConversationMessageOutput,
  SellerConversationOutput,
  SellerCursorConnection,
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
} from './types/seller-output.type';

interface SellerContext {
  accountId: bigint;
  storeId: bigint;
}

@Injectable()
export class SellerService {
  constructor(private readonly repo: SellerRepository) {}

  async sellerMyStore(accountId: bigint): Promise<SellerStoreOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const store = await this.repo.findStoreBySellerAccountId(ctx.accountId);
    if (!store) throw new NotFoundException('Store not found.');
    return this.toStoreOutput(store);
  }

  async sellerStoreBusinessHours(
    accountId: bigint,
  ): Promise<SellerStoreBusinessHourOutput[]> {
    const ctx = await this.requireSellerContext(accountId);
    const rows = await this.repo.listStoreBusinessHours(ctx.storeId);
    return rows.map((row) => this.toStoreBusinessHourOutput(row));
  }

  async sellerStoreSpecialClosures(
    accountId: bigint,
    input?: SellerCursorInput,
  ): Promise<SellerCursorConnection<SellerStoreSpecialClosureOutput>> {
    const ctx = await this.requireSellerContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? this.parseId(input.cursor) : null,
    });

    const rows = await this.repo.listStoreSpecialClosures({
      storeId: ctx.storeId,
      limit: normalized.limit,
      cursor: normalized.cursor,
    });

    const paged = nextCursorOf(rows, normalized.limit);
    return {
      items: paged.items.map((row) => this.toStoreSpecialClosureOutput(row)),
      nextCursor: paged.nextCursor,
    };
  }

  async sellerStoreDailyCapacities(
    accountId: bigint,
    input?: SellerDateCursorInput,
  ): Promise<SellerCursorConnection<SellerStoreDailyCapacityOutput>> {
    const ctx = await this.requireSellerContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? this.parseId(input.cursor) : null,
    });

    const rows = await this.repo.listStoreDailyCapacities({
      storeId: ctx.storeId,
      limit: normalized.limit,
      cursor: normalized.cursor,
      fromDate: this.toDate(input?.fromDate),
      toDate: this.toDate(input?.toDate),
    });

    const paged = nextCursorOf(rows, normalized.limit);
    return {
      items: paged.items.map((row) => this.toStoreDailyCapacityOutput(row)),
      nextCursor: paged.nextCursor,
    };
  }

  async sellerUpdateStoreBasicInfo(
    accountId: bigint,
    input: SellerUpdateStoreBasicInfoInput,
  ): Promise<SellerStoreOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const current = await this.repo.findStoreBySellerAccountId(ctx.accountId);
    if (!current) throw new NotFoundException('Store not found.');

    const data: Prisma.StoreUpdateInput = {
      ...(input.storeName !== undefined
        ? { store_name: this.cleanRequiredText(input.storeName, 200) }
        : {}),
      ...(input.storePhone !== undefined
        ? { store_phone: this.cleanRequiredText(input.storePhone, 30) }
        : {}),
      ...(input.addressFull !== undefined
        ? { address_full: this.cleanRequiredText(input.addressFull, 500) }
        : {}),
      ...(input.addressCity !== undefined
        ? { address_city: this.cleanNullableText(input.addressCity, 50) }
        : {}),
      ...(input.addressDistrict !== undefined
        ? {
            address_district: this.cleanNullableText(input.addressDistrict, 80),
          }
        : {}),
      ...(input.addressNeighborhood !== undefined
        ? {
            address_neighborhood: this.cleanNullableText(
              input.addressNeighborhood,
              80,
            ),
          }
        : {}),
      ...(input.latitude !== undefined
        ? { latitude: this.toDecimal(input.latitude) }
        : {}),
      ...(input.longitude !== undefined
        ? { longitude: this.toDecimal(input.longitude) }
        : {}),
      ...(input.mapProvider !== undefined && input.mapProvider !== null
        ? { map_provider: input.mapProvider }
        : {}),
      ...(input.websiteUrl !== undefined
        ? { website_url: this.cleanNullableText(input.websiteUrl, 2048) }
        : {}),
      ...(input.businessHoursText !== undefined
        ? {
            business_hours_text: this.cleanNullableText(
              input.businessHoursText,
              500,
            ),
          }
        : {}),
    };

    const updated = await this.repo.updateStore({
      storeId: ctx.storeId,
      data,
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: AuditActionType.UPDATE,
      beforeJson: {
        storeName: current.store_name,
        storePhone: current.store_phone,
      },
      afterJson: {
        storeName: updated.store_name,
        storePhone: updated.store_phone,
      },
    });

    return this.toStoreOutput(updated);
  }

  async sellerUpsertStoreBusinessHour(
    accountId: bigint,
    input: SellerUpsertStoreBusinessHourInput,
  ): Promise<SellerStoreBusinessHourOutput> {
    const ctx = await this.requireSellerContext(accountId);

    if (input.dayOfWeek < 0 || input.dayOfWeek > 6) {
      throw new BadRequestException('dayOfWeek must be 0~6.');
    }

    const openTime = input.isClosed ? null : this.toTime(input.openTime);
    const closeTime = input.isClosed ? null : this.toTime(input.closeTime);

    if (!input.isClosed && (!openTime || !closeTime)) {
      throw new BadRequestException('openTime and closeTime are required.');
    }

    if (openTime && closeTime && openTime >= closeTime) {
      throw new BadRequestException('closeTime must be after openTime.');
    }

    const row = await this.repo.upsertStoreBusinessHour({
      storeId: ctx.storeId,
      dayOfWeek: input.dayOfWeek,
      isClosed: input.isClosed,
      openTime,
      closeTime,
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: AuditActionType.UPDATE,
      afterJson: {
        dayOfWeek: row.day_of_week,
        isClosed: row.is_closed,
      },
    });

    return this.toStoreBusinessHourOutput(row);
  }

  async sellerUpsertStoreSpecialClosure(
    accountId: bigint,
    input: SellerUpsertStoreSpecialClosureInput,
  ): Promise<SellerStoreSpecialClosureOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const closureId = input.closureId
      ? this.parseId(input.closureId)
      : undefined;

    if (closureId) {
      const found = await this.repo.findStoreSpecialClosureById(
        closureId,
        ctx.storeId,
      );
      if (!found) throw new NotFoundException('Special closure not found.');
    }

    const row = await this.repo.upsertStoreSpecialClosure({
      storeId: ctx.storeId,
      closureId,
      closureDate: this.toDateRequired(input.closureDate, 'closureDate'),
      reason: this.cleanNullableText(input.reason, 200),
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: closureId ? AuditActionType.UPDATE : AuditActionType.CREATE,
      afterJson: {
        closureDate: row.closure_date.toISOString(),
        reason: row.reason,
      },
    });

    return this.toStoreSpecialClosureOutput(row);
  }

  async sellerDeleteStoreSpecialClosure(
    accountId: bigint,
    closureId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireSellerContext(accountId);
    const found = await this.repo.findStoreSpecialClosureById(
      closureId,
      ctx.storeId,
    );
    if (!found) throw new NotFoundException('Special closure not found.');

    await this.repo.softDeleteStoreSpecialClosure(closureId);
    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: AuditActionType.DELETE,
      beforeJson: {
        closureDate: found.closure_date.toISOString(),
      },
    });

    return true;
  }

  async sellerUpdatePickupPolicy(
    accountId: bigint,
    input: SellerUpdatePickupPolicyInput,
  ): Promise<SellerStoreOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const current = await this.repo.findStoreBySellerAccountId(ctx.accountId);
    if (!current) throw new NotFoundException('Store not found.');

    this.assertPositiveRange(
      input.pickupSlotIntervalMinutes,
      5,
      180,
      'pickupSlotIntervalMinutes',
    );
    this.assertPositiveRange(
      input.minLeadTimeMinutes,
      0,
      7 * 24 * 60,
      'minLeadTimeMinutes',
    );
    this.assertPositiveRange(input.maxDaysAhead, 1, 365, 'maxDaysAhead');

    const updated = await this.repo.updateStore({
      storeId: ctx.storeId,
      data: {
        pickup_slot_interval_minutes: input.pickupSlotIntervalMinutes,
        min_lead_time_minutes: input.minLeadTimeMinutes,
        max_days_ahead: input.maxDaysAhead,
      },
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: AuditActionType.UPDATE,
      beforeJson: {
        pickupSlotIntervalMinutes: current.pickup_slot_interval_minutes,
        minLeadTimeMinutes: current.min_lead_time_minutes,
        maxDaysAhead: current.max_days_ahead,
      },
      afterJson: {
        pickupSlotIntervalMinutes: updated.pickup_slot_interval_minutes,
        minLeadTimeMinutes: updated.min_lead_time_minutes,
        maxDaysAhead: updated.max_days_ahead,
      },
    });

    return this.toStoreOutput(updated);
  }

  async sellerUpsertStoreDailyCapacity(
    accountId: bigint,
    input: SellerUpsertStoreDailyCapacityInput,
  ): Promise<SellerStoreDailyCapacityOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const capacityId = input.capacityId
      ? this.parseId(input.capacityId)
      : undefined;

    if (capacityId) {
      const found = await this.repo.findStoreDailyCapacityById(
        capacityId,
        ctx.storeId,
      );
      if (!found) throw new NotFoundException('Daily capacity not found.');
    }

    this.assertPositiveRange(input.capacity, 1, 5000, 'capacity');

    const row = await this.repo.upsertStoreDailyCapacity({
      storeId: ctx.storeId,
      capacityId,
      capacityDate: this.toDateRequired(input.capacityDate, 'capacityDate'),
      capacity: input.capacity,
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: capacityId ? AuditActionType.UPDATE : AuditActionType.CREATE,
      afterJson: {
        capacityDate: row.capacity_date.toISOString().slice(0, 10),
        capacity: row.capacity,
      },
    });

    return this.toStoreDailyCapacityOutput(row);
  }

  async sellerDeleteStoreDailyCapacity(
    accountId: bigint,
    capacityId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireSellerContext(accountId);
    const found = await this.repo.findStoreDailyCapacityById(
      capacityId,
      ctx.storeId,
    );
    if (!found) throw new NotFoundException('Daily capacity not found.');

    await this.repo.softDeleteStoreDailyCapacity(capacityId);
    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.STORE,
      targetId: ctx.storeId,
      action: AuditActionType.DELETE,
      beforeJson: {
        capacityDate: found.capacity_date.toISOString().slice(0, 10),
        capacity: found.capacity,
      },
    });
    return true;
  }

  async sellerProducts(
    accountId: bigint,
    input?: SellerProductListInput,
  ): Promise<SellerCursorConnection<SellerProductOutput>> {
    const ctx = await this.requireSellerContext(accountId);

    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? this.parseId(input.cursor) : null,
    });

    const rows = await this.repo.listProductsByStore({
      storeId: ctx.storeId,
      limit: normalized.limit,
      cursor: normalized.cursor,
      isActive: input?.isActive ?? true,
      categoryId: input?.categoryId
        ? this.parseId(input.categoryId)
        : undefined,
      search: input?.search?.trim() || undefined,
    });

    const paged = nextCursorOf(rows, normalized.limit);
    return {
      items: paged.items.map((row) => this.toProductOutput(row)),
      nextCursor: paged.nextCursor,
    };
  }

  async sellerProduct(
    accountId: bigint,
    productId: bigint,
  ): Promise<SellerProductOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const row = await this.repo.findProductById({
      productId,
      storeId: ctx.storeId,
    });

    if (!row) throw new NotFoundException('Product not found.');
    return this.toProductOutput(row);
  }

  async sellerCreateProduct(
    accountId: bigint,
    input: SellerCreateProductInput,
  ): Promise<SellerProductOutput> {
    const ctx = await this.requireSellerContext(accountId);

    this.assertPositiveRange(
      input.regularPrice,
      1,
      1_000_000_000,
      'regularPrice',
    );
    if (input.salePrice !== undefined && input.salePrice !== null) {
      this.assertPositiveRange(input.salePrice, 0, 1_000_000_000, 'salePrice');
      if (input.salePrice > input.regularPrice) {
        throw new BadRequestException(
          'salePrice must be less than or equal to regularPrice.',
        );
      }
    }

    const created = await this.repo.createProduct({
      storeId: ctx.storeId,
      data: {
        name: this.cleanRequiredText(input.name, 200),
        description: this.cleanNullableText(input.description, 50000),
        purchase_notice: this.cleanNullableText(input.purchaseNotice, 50000),
        regular_price: input.regularPrice,
        sale_price: input.salePrice ?? null,
        currency: this.cleanCurrency(input.currency),
        base_design_image_url: this.cleanNullableText(
          input.baseDesignImageUrl,
          2048,
        ),
        preparation_time_minutes: input.preparationTimeMinutes ?? 180,
        is_active: input.isActive ?? true,
      },
    });

    await this.repo.addProductImage({
      productId: created.id,
      imageUrl: this.cleanRequiredText(input.initialImageUrl, 2048),
      sortOrder: 0,
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: created.id,
      action: AuditActionType.CREATE,
      afterJson: {
        name: created.name,
        regularPrice: created.regular_price,
      },
    });

    const detail = await this.repo.findProductByIdIncludingInactive({
      productId: created.id,
      storeId: ctx.storeId,
    });
    if (!detail) throw new NotFoundException('Product not found.');
    return this.toProductOutput(detail);
  }

  async sellerUpdateProduct(
    accountId: bigint,
    input: SellerUpdateProductInput,
  ): Promise<SellerProductOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = this.parseId(input.productId);

    const current = await this.repo.findProductByIdIncludingInactive({
      productId,
      storeId: ctx.storeId,
    });
    if (!current) throw new NotFoundException('Product not found.');

    const data: Prisma.ProductUpdateInput = {
      ...(input.name !== undefined
        ? { name: this.cleanRequiredText(input.name, 200) }
        : {}),
      ...(input.description !== undefined
        ? { description: this.cleanNullableText(input.description, 50000) }
        : {}),
      ...(input.purchaseNotice !== undefined
        ? {
            purchase_notice: this.cleanNullableText(
              input.purchaseNotice,
              50000,
            ),
          }
        : {}),
      ...(input.regularPrice !== undefined && input.regularPrice !== null
        ? { regular_price: input.regularPrice }
        : {}),
      ...(input.salePrice !== undefined ? { sale_price: input.salePrice } : {}),
      ...(input.currency !== undefined
        ? { currency: this.cleanCurrency(input.currency) }
        : {}),
      ...(input.baseDesignImageUrl !== undefined
        ? {
            base_design_image_url: this.cleanNullableText(
              input.baseDesignImageUrl,
              2048,
            ),
          }
        : {}),
      ...(input.preparationTimeMinutes !== undefined &&
      input.preparationTimeMinutes !== null
        ? { preparation_time_minutes: input.preparationTimeMinutes }
        : {}),
    };

    if (data.regular_price !== undefined) {
      this.assertPositiveRange(
        data.regular_price as number,
        1,
        1_000_000_000,
        'regularPrice',
      );
    }

    if (data.sale_price !== undefined && data.sale_price !== null) {
      this.assertPositiveRange(
        data.sale_price as number,
        0,
        1_000_000_000,
        'salePrice',
      );
    }

    const updated = await this.repo.updateProduct({
      productId,
      data,
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: productId,
      action: AuditActionType.UPDATE,
      beforeJson: {
        name: current.name,
      },
      afterJson: {
        name: updated.name,
      },
    });

    const detail = await this.repo.findProductByIdIncludingInactive({
      productId,
      storeId: ctx.storeId,
    });
    if (!detail) throw new NotFoundException('Product not found.');

    return this.toProductOutput(detail);
  }

  async sellerDeleteProduct(
    accountId: bigint,
    productId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireSellerContext(accountId);
    const current = await this.repo.findProductByIdIncludingInactive({
      productId,
      storeId: ctx.storeId,
    });
    if (!current) throw new NotFoundException('Product not found.');

    await this.repo.softDeleteProduct(productId);
    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: productId,
      action: AuditActionType.DELETE,
      beforeJson: {
        name: current.name,
      },
    });
    return true;
  }

  async sellerSetProductActive(
    accountId: bigint,
    input: SellerSetProductActiveInput,
  ): Promise<SellerProductOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = this.parseId(input.productId);

    const current = await this.repo.findProductByIdIncludingInactive({
      productId,
      storeId: ctx.storeId,
    });
    if (!current) throw new NotFoundException('Product not found.');

    await this.repo.updateProduct({
      productId,
      data: {
        is_active: input.isActive,
      },
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: productId,
      action: AuditActionType.STATUS_CHANGE,
      beforeJson: {
        isActive: current.is_active,
      },
      afterJson: {
        isActive: input.isActive,
      },
    });

    const detail = await this.repo.findProductByIdIncludingInactive({
      productId,
      storeId: ctx.storeId,
    });
    if (!detail) throw new NotFoundException('Product not found.');
    return this.toProductOutput(detail);
  }

  async sellerAddProductImage(
    accountId: bigint,
    input: SellerAddProductImageInput,
  ): Promise<SellerProductImageOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = this.parseId(input.productId);

    const product = await this.repo.findProductByIdIncludingInactive({
      productId,
      storeId: ctx.storeId,
    });
    if (!product) throw new NotFoundException('Product not found.');

    const count = await this.repo.countProductImages(productId);
    if (count >= 5) {
      throw new BadRequestException('Product images can be up to 5.');
    }

    const row = await this.repo.addProductImage({
      productId,
      imageUrl: this.cleanRequiredText(input.imageUrl, 2048),
      sortOrder: input.sortOrder ?? count,
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: productId,
      action: AuditActionType.UPDATE,
      afterJson: {
        imageId: row.id.toString(),
      },
    });

    return this.toProductImageOutput(row);
  }

  async sellerDeleteProductImage(
    accountId: bigint,
    imageId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireSellerContext(accountId);
    const image = await this.repo.findProductImageById(imageId);
    if (!image || image.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Product image not found.');
    }

    const count = await this.repo.countProductImages(image.product_id);
    if (count <= 1) {
      throw new BadRequestException('At least one product image is required.');
    }

    await this.repo.softDeleteProductImage(imageId);
    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: image.product_id,
      action: AuditActionType.UPDATE,
      beforeJson: {
        imageId: image.id.toString(),
      },
    });

    return true;
  }

  async sellerReorderProductImages(
    accountId: bigint,
    input: SellerReorderProductImagesInput,
  ): Promise<SellerProductImageOutput[]> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = this.parseId(input.productId);
    const imageIds = this.parseIdList(input.imageIds);

    const product = await this.repo.findProductByIdIncludingInactive({
      productId,
      storeId: ctx.storeId,
    });
    if (!product) throw new NotFoundException('Product not found.');

    const existing = await this.repo.listProductImages(productId);
    if (existing.length !== imageIds.length) {
      throw new BadRequestException('imageIds length mismatch.');
    }

    const existingSet = new Set(existing.map((row) => row.id.toString()));
    for (const id of imageIds) {
      if (!existingSet.has(id.toString())) {
        throw new BadRequestException('Invalid image id in imageIds.');
      }
    }

    const rows = await this.repo.reorderProductImages({
      productId,
      imageIds,
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: productId,
      action: AuditActionType.UPDATE,
      afterJson: {
        imageIds: imageIds.map((id) => id.toString()),
      },
    });

    return rows.map((row) => this.toProductImageOutput(row));
  }

  async sellerSetProductCategories(
    accountId: bigint,
    input: SellerSetProductCategoriesInput,
  ): Promise<SellerProductOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = this.parseId(input.productId);

    const product = await this.repo.findProductByIdIncludingInactive({
      productId,
      storeId: ctx.storeId,
    });
    if (!product) throw new NotFoundException('Product not found.');

    const categoryIds = this.parseIdList(input.categoryIds);
    const categories = await this.repo.findCategoryIds(categoryIds);
    if (categories.length !== categoryIds.length) {
      throw new BadRequestException('Invalid category ids.');
    }

    await this.repo.replaceProductCategories({
      productId,
      categoryIds,
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: productId,
      action: AuditActionType.UPDATE,
      afterJson: {
        categoryIds: categoryIds.map((id) => id.toString()),
      },
    });

    const detail = await this.repo.findProductByIdIncludingInactive({
      productId,
      storeId: ctx.storeId,
    });
    if (!detail) throw new NotFoundException('Product not found.');

    return this.toProductOutput(detail);
  }

  async sellerSetProductTags(
    accountId: bigint,
    input: SellerSetProductTagsInput,
  ): Promise<SellerProductOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = this.parseId(input.productId);

    const product = await this.repo.findProductByIdIncludingInactive({
      productId,
      storeId: ctx.storeId,
    });
    if (!product) throw new NotFoundException('Product not found.');

    const tagIds = this.parseIdList(input.tagIds);
    const tags = await this.repo.findTagIds(tagIds);
    if (tags.length !== tagIds.length) {
      throw new BadRequestException('Invalid tag ids.');
    }

    await this.repo.replaceProductTags({
      productId,
      tagIds,
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: productId,
      action: AuditActionType.UPDATE,
      afterJson: {
        tagIds: tagIds.map((id) => id.toString()),
      },
    });

    const detail = await this.repo.findProductByIdIncludingInactive({
      productId,
      storeId: ctx.storeId,
    });
    if (!detail) throw new NotFoundException('Product not found.');

    return this.toProductOutput(detail);
  }

  async sellerCreateOptionGroup(
    accountId: bigint,
    input: SellerCreateOptionGroupInput,
  ): Promise<SellerOptionGroupOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = this.parseId(input.productId);

    const product = await this.repo.findProductByIdIncludingInactive({
      productId,
      storeId: ctx.storeId,
    });
    if (!product) throw new NotFoundException('Product not found.');

    const minSelect = input.minSelect ?? 1;
    const maxSelect = input.maxSelect ?? 1;
    if (minSelect < 0 || maxSelect < minSelect) {
      throw new BadRequestException('Invalid minSelect/maxSelect.');
    }

    const row = await this.repo.createOptionGroup({
      productId,
      data: {
        name: this.cleanRequiredText(input.name, 120),
        is_required: input.isRequired ?? true,
        min_select: minSelect,
        max_select: maxSelect,
        option_requires_description: input.optionRequiresDescription ?? false,
        option_requires_image: input.optionRequiresImage ?? false,
        sort_order: input.sortOrder ?? 0,
        is_active: input.isActive ?? true,
      },
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: productId,
      action: AuditActionType.CREATE,
      afterJson: {
        optionGroupId: row.id.toString(),
      },
    });

    return this.toOptionGroupOutput(row);
  }

  async sellerUpdateOptionGroup(
    accountId: bigint,
    input: SellerUpdateOptionGroupInput,
  ): Promise<SellerOptionGroupOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const optionGroupId = this.parseId(input.optionGroupId);

    const current = await this.repo.findOptionGroupById(optionGroupId);
    if (!current || current.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Option group not found.');
    }

    if (
      input.minSelect !== undefined &&
      input.maxSelect !== undefined &&
      input.maxSelect < input.minSelect
    ) {
      throw new BadRequestException('maxSelect must be >= minSelect.');
    }

    const row = await this.repo.updateOptionGroup({
      optionGroupId,
      data: {
        ...(input.name !== undefined
          ? { name: this.cleanRequiredText(input.name, 120) }
          : {}),
        ...(input.isRequired !== undefined
          ? { is_required: input.isRequired }
          : {}),
        ...(input.minSelect !== undefined
          ? { min_select: input.minSelect }
          : {}),
        ...(input.maxSelect !== undefined
          ? { max_select: input.maxSelect }
          : {}),
        ...(input.optionRequiresDescription !== undefined
          ? { option_requires_description: input.optionRequiresDescription }
          : {}),
        ...(input.optionRequiresImage !== undefined
          ? { option_requires_image: input.optionRequiresImage }
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
      targetType: AuditTargetType.PRODUCT,
      targetId: current.product_id,
      action: AuditActionType.UPDATE,
      afterJson: {
        optionGroupId: optionGroupId.toString(),
      },
    });

    return this.toOptionGroupOutput(row);
  }

  async sellerDeleteOptionGroup(
    accountId: bigint,
    optionGroupId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireSellerContext(accountId);
    const current = await this.repo.findOptionGroupById(optionGroupId);
    if (!current || current.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Option group not found.');
    }

    await this.repo.softDeleteOptionGroup(optionGroupId);
    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: current.product_id,
      action: AuditActionType.DELETE,
      beforeJson: {
        optionGroupId: optionGroupId.toString(),
      },
    });

    return true;
  }

  async sellerReorderOptionGroups(
    accountId: bigint,
    input: SellerReorderOptionGroupsInput,
  ): Promise<SellerOptionGroupOutput[]> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = this.parseId(input.productId);
    const optionGroupIds = this.parseIdList(input.optionGroupIds);

    const product = await this.repo.findProductByIdIncludingInactive({
      productId,
      storeId: ctx.storeId,
    });
    if (!product) throw new NotFoundException('Product not found.');

    const groups = await this.repo.listOptionGroupsByProduct(productId);
    if (groups.length !== optionGroupIds.length) {
      throw new BadRequestException('optionGroupIds length mismatch.');
    }

    const idSet = new Set(groups.map((g) => g.id.toString()));
    for (const id of optionGroupIds) {
      if (!idSet.has(id.toString())) {
        throw new BadRequestException('Invalid optionGroupIds.');
      }
    }

    const rows = await this.repo.reorderOptionGroups({
      productId,
      optionGroupIds,
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: productId,
      action: AuditActionType.UPDATE,
      afterJson: {
        optionGroupIds: optionGroupIds.map((id) => id.toString()),
      },
    });

    return rows.map((row) => this.toOptionGroupOutput(row));
  }

  async sellerCreateOptionItem(
    accountId: bigint,
    input: SellerCreateOptionItemInput,
  ): Promise<SellerOptionItemOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const optionGroupId = this.parseId(input.optionGroupId);
    const group = await this.repo.findOptionGroupById(optionGroupId);

    if (!group || group.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Option group not found.');
    }

    const row = await this.repo.createOptionItem({
      optionGroupId,
      data: {
        title: this.cleanRequiredText(input.title, 120),
        description: this.cleanNullableText(input.description, 500),
        image_url: this.cleanNullableText(input.imageUrl, 2048),
        price_delta: input.priceDelta ?? 0,
        sort_order: input.sortOrder ?? 0,
        is_active: input.isActive ?? true,
      },
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: group.product_id,
      action: AuditActionType.CREATE,
      afterJson: {
        optionItemId: row.id.toString(),
      },
    });

    return this.toOptionItemOutput(row);
  }

  async sellerUpdateOptionItem(
    accountId: bigint,
    input: SellerUpdateOptionItemInput,
  ): Promise<SellerOptionItemOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const optionItemId = this.parseId(input.optionItemId);

    const current = await this.repo.findOptionItemById(optionItemId);
    if (!current || current.option_group.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Option item not found.');
    }

    const row = await this.repo.updateOptionItem({
      optionItemId,
      data: {
        ...(input.title !== undefined
          ? { title: this.cleanRequiredText(input.title, 120) }
          : {}),
        ...(input.description !== undefined
          ? { description: this.cleanNullableText(input.description, 500) }
          : {}),
        ...(input.imageUrl !== undefined
          ? { image_url: this.cleanNullableText(input.imageUrl, 2048) }
          : {}),
        ...(input.priceDelta !== undefined
          ? { price_delta: input.priceDelta }
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
      targetType: AuditTargetType.PRODUCT,
      targetId: current.option_group.product_id,
      action: AuditActionType.UPDATE,
      afterJson: {
        optionItemId: row.id.toString(),
      },
    });

    return this.toOptionItemOutput(row);
  }

  async sellerDeleteOptionItem(
    accountId: bigint,
    optionItemId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireSellerContext(accountId);
    const current = await this.repo.findOptionItemById(optionItemId);
    if (!current || current.option_group.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Option item not found.');
    }

    await this.repo.softDeleteOptionItem(optionItemId);
    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: current.option_group.product_id,
      action: AuditActionType.DELETE,
      beforeJson: {
        optionItemId: optionItemId.toString(),
      },
    });

    return true;
  }

  async sellerReorderOptionItems(
    accountId: bigint,
    input: SellerReorderOptionItemsInput,
  ): Promise<SellerOptionItemOutput[]> {
    const ctx = await this.requireSellerContext(accountId);
    const optionGroupId = this.parseId(input.optionGroupId);
    const optionItemIds = this.parseIdList(input.optionItemIds);

    const group = await this.repo.findOptionGroupById(optionGroupId);
    if (!group || group.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Option group not found.');
    }

    const items = await this.repo.listOptionItemsByGroup(optionGroupId);
    if (items.length !== optionItemIds.length) {
      throw new BadRequestException('optionItemIds length mismatch.');
    }

    const idSet = new Set(items.map((item) => item.id.toString()));
    for (const id of optionItemIds) {
      if (!idSet.has(id.toString())) {
        throw new BadRequestException('Invalid optionItemIds.');
      }
    }

    const rows = await this.repo.reorderOptionItems({
      optionGroupId,
      optionItemIds,
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: group.product_id,
      action: AuditActionType.UPDATE,
      afterJson: {
        optionItemIds: optionItemIds.map((id) => id.toString()),
      },
    });

    return rows.map((row) => this.toOptionItemOutput(row));
  }

  async sellerUpsertProductCustomTemplate(
    accountId: bigint,
    input: SellerUpsertProductCustomTemplateInput,
  ): Promise<SellerCustomTemplateOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = this.parseId(input.productId);

    const product = await this.repo.findProductByIdIncludingInactive({
      productId,
      storeId: ctx.storeId,
    });
    if (!product) throw new NotFoundException('Product not found.');

    const row = await this.repo.upsertProductCustomTemplate({
      productId,
      baseImageUrl: this.cleanRequiredText(input.baseImageUrl, 2048),
      isActive: input.isActive ?? true,
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: productId,
      action: AuditActionType.UPDATE,
      afterJson: {
        templateId: row.id.toString(),
      },
    });

    return this.toCustomTemplateOutput(row);
  }

  async sellerSetProductCustomTemplateActive(
    accountId: bigint,
    input: SellerSetProductCustomTemplateActiveInput,
  ): Promise<SellerCustomTemplateOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const templateId = this.parseId(input.templateId);

    const template = await this.repo.findCustomTemplateById(templateId);
    if (!template || template.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Custom template not found.');
    }

    const row = await this.repo.setCustomTemplateActive(
      templateId,
      input.isActive,
    );

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: template.product_id,
      action: AuditActionType.STATUS_CHANGE,
      afterJson: {
        templateId: row.id.toString(),
        isActive: row.is_active,
      },
    });

    return this.toCustomTemplateOutput(row);
  }

  async sellerUpsertProductCustomTextToken(
    accountId: bigint,
    input: SellerUpsertProductCustomTextTokenInput,
  ): Promise<SellerCustomTextTokenOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const templateId = this.parseId(input.templateId);
    const tokenId = input.tokenId ? this.parseId(input.tokenId) : undefined;

    const template = await this.repo.findCustomTemplateById(templateId);
    if (!template || template.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Custom template not found.');
    }

    if (tokenId) {
      const token = await this.repo.findCustomTextTokenById(tokenId);
      if (!token || token.template.product.store_id !== ctx.storeId) {
        throw new NotFoundException('Custom text token not found.');
      }
    }

    const row = await this.repo.upsertCustomTextToken({
      tokenId,
      templateId,
      tokenKey: this.cleanRequiredText(input.tokenKey, 60),
      defaultText: this.cleanRequiredText(input.defaultText, 200),
      maxLength: input.maxLength ?? 30,
      sortOrder: input.sortOrder ?? 0,
      isRequired: input.isRequired ?? true,
      posX: input.posX ?? null,
      posY: input.posY ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: template.product_id,
      action: tokenId ? AuditActionType.UPDATE : AuditActionType.CREATE,
      afterJson: {
        tokenId: row.id.toString(),
        tokenKey: row.token_key,
      },
    });

    return this.toCustomTextTokenOutput(row);
  }

  async sellerDeleteProductCustomTextToken(
    accountId: bigint,
    tokenId: bigint,
  ): Promise<boolean> {
    const ctx = await this.requireSellerContext(accountId);
    const token = await this.repo.findCustomTextTokenById(tokenId);
    if (!token || token.template.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Custom text token not found.');
    }

    await this.repo.softDeleteCustomTextToken(tokenId);
    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: token.template.product_id,
      action: AuditActionType.DELETE,
      beforeJson: {
        tokenId: token.id.toString(),
        tokenKey: token.token_key,
      },
    });

    return true;
  }

  async sellerReorderProductCustomTextTokens(
    accountId: bigint,
    input: SellerReorderProductCustomTextTokensInput,
  ): Promise<SellerCustomTextTokenOutput[]> {
    const ctx = await this.requireSellerContext(accountId);
    const templateId = this.parseId(input.templateId);
    const tokenIds = this.parseIdList(input.tokenIds);

    const template = await this.repo.findCustomTemplateById(templateId);
    if (!template || template.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Custom template not found.');
    }

    const tokens = await this.repo.listCustomTextTokens(templateId);
    if (tokens.length !== tokenIds.length) {
      throw new BadRequestException('tokenIds length mismatch.');
    }

    const idSet = new Set(tokens.map((token) => token.id.toString()));
    for (const id of tokenIds) {
      if (!idSet.has(id.toString())) {
        throw new BadRequestException('Invalid tokenIds.');
      }
    }

    const rows = await this.repo.reorderCustomTextTokens({
      templateId,
      tokenIds,
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.PRODUCT,
      targetId: template.product_id,
      action: AuditActionType.UPDATE,
      afterJson: {
        tokenIds: tokenIds.map((id) => id.toString()),
      },
    });

    return rows.map((row) => this.toCustomTextTokenOutput(row));
  }

  async sellerOrderList(
    accountId: bigint,
    input?: SellerOrderListInput,
  ): Promise<SellerCursorConnection<SellerOrderSummaryOutput>> {
    const ctx = await this.requireSellerContext(accountId);

    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? this.parseId(input.cursor) : null,
    });

    const rows = await this.repo.listOrdersByStore({
      storeId: ctx.storeId,
      limit: normalized.limit,
      cursor: normalized.cursor,
      status: input?.status ? this.toOrderStatus(input.status) : undefined,
      fromCreatedAt: this.toDate(input?.fromCreatedAt),
      toCreatedAt: this.toDate(input?.toCreatedAt),
      fromPickupAt: this.toDate(input?.fromPickupAt),
      toPickupAt: this.toDate(input?.toPickupAt),
      search: input?.search?.trim() || undefined,
    });

    const paged = nextCursorOf(rows, normalized.limit);
    return {
      items: paged.items.map((row) => this.toOrderSummaryOutput(row)),
      nextCursor: paged.nextCursor,
    };
  }

  async sellerOrder(
    accountId: bigint,
    orderId: bigint,
  ): Promise<SellerOrderDetailOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const row = await this.repo.findOrderDetailByStore({
      orderId,
      storeId: ctx.storeId,
    });
    if (!row) throw new NotFoundException('Order not found.');
    return this.toOrderDetailOutput(row);
  }

  async sellerUpdateOrderStatus(
    accountId: bigint,
    input: SellerUpdateOrderStatusInput,
  ): Promise<SellerOrderSummaryOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const orderId = this.parseId(input.orderId);
    const toStatus = this.toOrderStatus(input.toStatus);

    const current = await this.repo.findOrderDetailByStore({
      orderId,
      storeId: ctx.storeId,
    });
    if (!current) throw new NotFoundException('Order not found.');

    this.assertOrderStatusTransition(current.status, toStatus);

    if (toStatus === OrderStatus.CANCELED) {
      if (!input.note || input.note.trim().length === 0) {
        throw new BadRequestException('Cancellation note is required.');
      }
    }

    const updated = await this.repo.updateOrderStatusBySeller({
      orderId,
      storeId: ctx.storeId,
      actorAccountId: ctx.accountId,
      toStatus,
      note: this.cleanNullableText(input.note, 500),
      now: new Date(),
    });

    if (!updated) throw new NotFoundException('Order not found.');

    return this.toOrderSummaryOutput(updated);
  }

  async sellerConversations(
    accountId: bigint,
    input?: SellerCursorInput,
  ): Promise<SellerCursorConnection<SellerConversationOutput>> {
    const ctx = await this.requireSellerContext(accountId);
    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? this.parseId(input.cursor) : null,
    });

    const rows = await this.repo.listConversationsByStore({
      storeId: ctx.storeId,
      limit: normalized.limit,
      cursor: normalized.cursor,
    });

    const paged = nextCursorOf(rows, normalized.limit);
    return {
      items: paged.items.map((row) => this.toConversationOutput(row)),
      nextCursor: paged.nextCursor,
    };
  }

  async sellerConversationMessages(
    accountId: bigint,
    conversationId: bigint,
    input?: SellerCursorInput,
  ): Promise<SellerCursorConnection<SellerConversationMessageOutput>> {
    const ctx = await this.requireSellerContext(accountId);
    const conversation = await this.repo.findConversationByIdAndStore({
      conversationId,
      storeId: ctx.storeId,
    });
    if (!conversation) throw new NotFoundException('Conversation not found.');

    const normalized = normalizeCursorInput({
      limit: input?.limit ?? null,
      cursor: input?.cursor ? this.parseId(input.cursor) : null,
    });

    const rows = await this.repo.listConversationMessages({
      conversationId,
      limit: normalized.limit,
      cursor: normalized.cursor,
    });

    const paged = nextCursorOf(rows, normalized.limit);
    return {
      items: paged.items.map((row) => this.toConversationMessageOutput(row)),
      nextCursor: paged.nextCursor,
    };
  }

  async sellerSendConversationMessage(
    accountId: bigint,
    input: SellerSendConversationMessageInput,
  ): Promise<SellerConversationMessageOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const conversationId = this.parseId(input.conversationId);

    const conversation = await this.repo.findConversationByIdAndStore({
      conversationId,
      storeId: ctx.storeId,
    });
    if (!conversation) throw new NotFoundException('Conversation not found.');

    const bodyFormat = this.toConversationBodyFormat(input.bodyFormat);
    const bodyText = this.cleanNullableText(input.bodyText, 2000);
    const bodyHtml = this.cleanNullableText(input.bodyHtml, 100000);

    if (bodyFormat === ConversationBodyFormat.TEXT && !bodyText) {
      throw new BadRequestException('bodyText is required for TEXT format.');
    }
    if (bodyFormat === ConversationBodyFormat.HTML && !bodyHtml) {
      throw new BadRequestException('bodyHtml is required for HTML format.');
    }

    const row = await this.repo.createSellerConversationMessage({
      conversationId,
      sellerAccountId: ctx.accountId,
      bodyFormat,
      bodyText,
      bodyHtml,
      now: new Date(),
    });

    await this.repo.createAuditLog({
      actorAccountId: ctx.accountId,
      storeId: ctx.storeId,
      targetType: AuditTargetType.CONVERSATION,
      targetId: conversationId,
      action: AuditActionType.CREATE,
      afterJson: {
        messageId: row.id.toString(),
      },
    });

    return this.toConversationMessageOutput(row);
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
      title: this.cleanRequiredText(input.title, 120),
      answerHtml: this.cleanRequiredText(input.answerHtml, 100000),
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
    const topicId = this.parseId(input.topicId);

    const current = await this.repo.findFaqTopicById({
      topicId,
      storeId: ctx.storeId,
    });
    if (!current) throw new NotFoundException('FAQ topic not found.');

    const row = await this.repo.updateFaqTopic({
      topicId,
      data: {
        ...(input.title !== undefined
          ? { title: this.cleanRequiredText(input.title, 120) }
          : {}),
        ...(input.answerHtml !== undefined
          ? { answer_html: this.cleanRequiredText(input.answerHtml, 100000) }
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
    if (!current) throw new NotFoundException('FAQ topic not found.');

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
      cursor: input?.cursor ? this.parseId(input.cursor) : null,
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
      linkProductId: input.linkProductId
        ? this.parseId(input.linkProductId)
        : null,
      linkStoreId: input.linkStoreId ? this.parseId(input.linkStoreId) : null,
      linkCategoryId: input.linkCategoryId
        ? this.parseId(input.linkCategoryId)
        : null,
      linkUrl: input.linkUrl ?? null,
    });

    const row = await this.repo.createBanner({
      placement: this.toBannerPlacement(input.placement),
      title: this.cleanNullableText(input.title, 200),
      imageUrl: this.cleanRequiredText(input.imageUrl, 2048),
      linkType: this.toBannerLinkType(input.linkType ?? 'NONE'),
      linkUrl: this.cleanNullableText(input.linkUrl, 2048),
      linkProductId: input.linkProductId
        ? this.parseId(input.linkProductId)
        : null,
      linkStoreId: input.linkStoreId ? this.parseId(input.linkStoreId) : null,
      linkCategoryId: input.linkCategoryId
        ? this.parseId(input.linkCategoryId)
        : null,
      startsAt: this.toDate(input.startsAt) ?? null,
      endsAt: this.toDate(input.endsAt) ?? null,
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
    const bannerId = this.parseId(input.bannerId);

    const current = await this.repo.findBannerByIdForStore({
      bannerId,
      storeId: ctx.storeId,
    });
    if (!current) throw new NotFoundException('Banner not found.');

    const nextLinkType = input.linkType ?? current.link_type;
    const nextLinkProductId =
      input.linkProductId !== undefined
        ? input.linkProductId
          ? this.parseId(input.linkProductId)
          : null
        : current.link_product_id;
    const nextLinkStoreId =
      input.linkStoreId !== undefined
        ? input.linkStoreId
          ? this.parseId(input.linkStoreId)
          : null
        : current.link_store_id;
    const nextLinkCategoryId =
      input.linkCategoryId !== undefined
        ? input.linkCategoryId
          ? this.parseId(input.linkCategoryId)
          : null
        : current.link_category_id;
    const nextLinkUrl =
      input.linkUrl !== undefined ? input.linkUrl : current.link_url;

    await this.validateBannerOwnership(ctx, {
      linkType: nextLinkType,
      linkProductId: nextLinkProductId,
      linkStoreId: nextLinkStoreId,
      linkCategoryId: nextLinkCategoryId,
      linkUrl: nextLinkUrl,
    });

    const row = await this.repo.updateBanner({
      bannerId,
      data: {
        ...(input.placement !== undefined
          ? { placement: this.toBannerPlacement(input.placement) }
          : {}),
        ...(input.title !== undefined
          ? { title: this.cleanNullableText(input.title, 200) }
          : {}),
        ...(input.imageUrl !== undefined
          ? { image_url: this.cleanRequiredText(input.imageUrl, 2048) }
          : {}),
        ...(input.linkType !== undefined
          ? { link_type: this.toBannerLinkType(input.linkType) }
          : {}),
        ...(input.linkUrl !== undefined
          ? { link_url: this.cleanNullableText(input.linkUrl, 2048) }
          : {}),
        ...(input.linkProductId !== undefined
          ? {
              link_product_id: input.linkProductId
                ? this.parseId(input.linkProductId)
                : null,
            }
          : {}),
        ...(input.linkStoreId !== undefined
          ? {
              link_store_id: input.linkStoreId
                ? this.parseId(input.linkStoreId)
                : null,
            }
          : {}),
        ...(input.linkCategoryId !== undefined
          ? {
              link_category_id: input.linkCategoryId
                ? this.parseId(input.linkCategoryId)
                : null,
            }
          : {}),
        ...(input.startsAt !== undefined
          ? { starts_at: this.toDate(input.startsAt) ?? null }
          : {}),
        ...(input.endsAt !== undefined
          ? { ends_at: this.toDate(input.endsAt) ?? null }
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
        bannerId: row.id.toString(),
      },
    });

    return this.toBannerOutput(row);
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
    if (!current) throw new NotFoundException('Banner not found.');

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
      cursor: input?.cursor ? this.parseId(input.cursor) : null,
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

  private async requireSellerContext(
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

  private async validateBannerOwnership(
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

  private assertOrderStatusTransition(
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

  private toOrderStatus(raw: string): OrderStatus {
    if (raw === 'SUBMITTED') return OrderStatus.SUBMITTED;
    if (raw === 'CONFIRMED') return OrderStatus.CONFIRMED;
    if (raw === 'MADE') return OrderStatus.MADE;
    if (raw === 'PICKED_UP') return OrderStatus.PICKED_UP;
    if (raw === 'CANCELED') return OrderStatus.CANCELED;
    throw new BadRequestException('Invalid order status.');
  }

  private toConversationBodyFormat(raw: string): ConversationBodyFormat {
    if (raw === 'TEXT') return ConversationBodyFormat.TEXT;
    if (raw === 'HTML') return ConversationBodyFormat.HTML;
    throw new BadRequestException('Invalid body format.');
  }

  private toBannerPlacement(raw: string): BannerPlacement {
    if (raw === 'HOME_MAIN') return BannerPlacement.HOME_MAIN;
    if (raw === 'HOME_SUB') return BannerPlacement.HOME_SUB;
    if (raw === 'CATEGORY') return BannerPlacement.CATEGORY;
    if (raw === 'STORE') return BannerPlacement.STORE;
    throw new BadRequestException('Invalid banner placement.');
  }

  private toBannerLinkType(raw: string): BannerLinkType {
    if (raw === 'NONE') return BannerLinkType.NONE;
    if (raw === 'URL') return BannerLinkType.URL;
    if (raw === 'PRODUCT') return BannerLinkType.PRODUCT;
    if (raw === 'STORE') return BannerLinkType.STORE;
    if (raw === 'CATEGORY') return BannerLinkType.CATEGORY;
    throw new BadRequestException('Invalid banner link type.');
  }

  private toAuditTargetType(raw: string): AuditTargetType {
    if (raw === 'STORE') return AuditTargetType.STORE;
    if (raw === 'PRODUCT') return AuditTargetType.PRODUCT;
    if (raw === 'ORDER') return AuditTargetType.ORDER;
    if (raw === 'CONVERSATION') return AuditTargetType.CONVERSATION;
    if (raw === 'CHANGE_PASSWORD') return AuditTargetType.CHANGE_PASSWORD;
    throw new BadRequestException('Invalid audit target type.');
  }

  private parseId(raw: string): bigint {
    try {
      return BigInt(raw);
    } catch {
      throw new BadRequestException('Invalid id.');
    }
  }

  private parseIdList(rawIds: string[]): bigint[] {
    const parsed = rawIds.map((id) => this.parseId(id));
    const set = new Set(parsed.map((id) => id.toString()));
    if (set.size !== parsed.length) {
      throw new BadRequestException('Duplicate ids are not allowed.');
    }
    return parsed;
  }

  private toDate(raw?: Date | string | null): Date | undefined {
    if (raw === undefined || raw === null) return undefined;
    const date = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date value.');
    }
    return date;
  }

  private toDateRequired(raw: Date | string, field: string): Date {
    const date = this.toDate(raw);
    if (!date) throw new BadRequestException(`${field} is required.`);
    return date;
  }

  private toTime(raw?: Date | string | null): Date | null {
    if (raw === undefined || raw === null) return null;
    const date = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid time value.');
    }
    return date;
  }

  private toDecimal(raw?: string | null): Prisma.Decimal | null {
    if (raw === undefined || raw === null) return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    try {
      return new Prisma.Decimal(trimmed);
    } catch {
      throw new BadRequestException('Invalid decimal value.');
    }
  }

  private cleanRequiredText(raw: string, maxLength: number): string {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException('Required text is empty.');
    }
    if (trimmed.length > maxLength) {
      throw new BadRequestException(`Text exceeds ${maxLength} length.`);
    }
    return trimmed;
  }

  private cleanNullableText(
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

  private cleanCurrency(raw?: string | null): string {
    const value = (raw ?? 'KRW').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(value)) {
      throw new BadRequestException('Invalid currency format.');
    }
    return value;
  }

  private assertPositiveRange(
    value: number,
    min: number,
    max: number,
    field: string,
  ): void {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new BadRequestException(`${field} must be ${min}~${max}.`);
    }
  }

  private toStoreOutput(row: {
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

  private toStoreBusinessHourOutput(row: {
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

  private toStoreSpecialClosureOutput(row: {
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

  private toStoreDailyCapacityOutput(row: {
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

  private toProductOutput(row: {
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

  private toProductImageOutput(row: {
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

  private toOptionGroupOutput(row: {
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

  private toOptionItemOutput(row: {
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

  private toCustomTemplateOutput(row: {
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

  private toCustomTextTokenOutput(row: {
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

  private toOrderSummaryOutput(row: {
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

  private toOrderDetailOutput(row: {
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

  private toConversationOutput(row: {
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

  private toConversationMessageOutput(row: {
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
