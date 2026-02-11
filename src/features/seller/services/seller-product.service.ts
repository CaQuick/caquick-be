import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditActionType, AuditTargetType, Prisma } from '@prisma/client';

import { ProductRepository } from '../../product';
import {
  nextCursorOf,
  normalizeCursorInput,
  SellerRepository,
} from '../repositories/seller.repository';
import type {
  SellerAddProductImageInput,
  SellerCreateOptionGroupInput,
  SellerCreateOptionItemInput,
  SellerCreateProductInput,
  SellerProductListInput,
  SellerReorderOptionGroupsInput,
  SellerReorderOptionItemsInput,
  SellerReorderProductCustomTextTokensInput,
  SellerReorderProductImagesInput,
  SellerSetProductActiveInput,
  SellerSetProductCategoriesInput,
  SellerSetProductCustomTemplateActiveInput,
  SellerSetProductTagsInput,
  SellerUpdateOptionGroupInput,
  SellerUpdateOptionItemInput,
  SellerUpdateProductInput,
  SellerUpsertProductCustomTemplateInput,
  SellerUpsertProductCustomTextTokenInput,
} from '../types/seller-input.type';
import type {
  SellerCursorConnection,
  SellerCustomTemplateOutput,
  SellerCustomTextTokenOutput,
  SellerOptionGroupOutput,
  SellerOptionItemOutput,
  SellerProductImageOutput,
  SellerProductOutput,
} from '../types/seller-output.type';

import { SellerBaseService } from './seller-base.service';

@Injectable()
export class SellerProductService extends SellerBaseService {
  constructor(
    repo: SellerRepository,
    private readonly productRepository: ProductRepository,
  ) {
    super(repo);
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

    const rows = await this.productRepository.listProductsByStore({
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
    const row = await this.productRepository.findProductById({
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

    const created = await this.productRepository.createProduct({
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

    await this.productRepository.addProductImage({
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

    const detail =
      await this.productRepository.findProductByIdIncludingInactive({
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

    const current =
      await this.productRepository.findProductByIdIncludingInactive({
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

    const updated = await this.productRepository.updateProduct({
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

    const detail =
      await this.productRepository.findProductByIdIncludingInactive({
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
    const current =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!current) throw new NotFoundException('Product not found.');

    await this.productRepository.softDeleteProduct(productId);
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

    const current =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!current) throw new NotFoundException('Product not found.');

    await this.productRepository.updateProduct({
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

    const detail =
      await this.productRepository.findProductByIdIncludingInactive({
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

    const product =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!product) throw new NotFoundException('Product not found.');

    const count = await this.productRepository.countProductImages(productId);
    if (count >= 5) {
      throw new BadRequestException('Product images can be up to 5.');
    }

    const row = await this.productRepository.addProductImage({
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
    const image = await this.productRepository.findProductImageById(imageId);
    if (!image || image.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Product image not found.');
    }

    const count = await this.productRepository.countProductImages(
      image.product_id,
    );
    if (count <= 1) {
      throw new BadRequestException('At least one product image is required.');
    }

    await this.productRepository.softDeleteProductImage(imageId);
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

    const product =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!product) throw new NotFoundException('Product not found.');

    const existing = await this.productRepository.listProductImages(productId);
    if (existing.length !== imageIds.length) {
      throw new BadRequestException('imageIds length mismatch.');
    }

    const existingSet = new Set(existing.map((row) => row.id.toString()));
    for (const id of imageIds) {
      if (!existingSet.has(id.toString())) {
        throw new BadRequestException('Invalid image id in imageIds.');
      }
    }

    const rows = await this.productRepository.reorderProductImages({
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

    const product =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!product) throw new NotFoundException('Product not found.');

    const categoryIds = this.parseIdList(input.categoryIds);
    const categories =
      await this.productRepository.findCategoryIds(categoryIds);
    if (categories.length !== categoryIds.length) {
      throw new BadRequestException('Invalid category ids.');
    }

    await this.productRepository.replaceProductCategories({
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

    const detail =
      await this.productRepository.findProductByIdIncludingInactive({
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

    const product =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!product) throw new NotFoundException('Product not found.');

    const tagIds = this.parseIdList(input.tagIds);
    const tags = await this.productRepository.findTagIds(tagIds);
    if (tags.length !== tagIds.length) {
      throw new BadRequestException('Invalid tag ids.');
    }

    await this.productRepository.replaceProductTags({
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

    const detail =
      await this.productRepository.findProductByIdIncludingInactive({
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

    const product =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!product) throw new NotFoundException('Product not found.');

    const minSelect = input.minSelect ?? 1;
    const maxSelect = input.maxSelect ?? 1;
    if (minSelect < 0 || maxSelect < minSelect) {
      throw new BadRequestException('Invalid minSelect/maxSelect.');
    }

    const row = await this.productRepository.createOptionGroup({
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

    const current =
      await this.productRepository.findOptionGroupById(optionGroupId);
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

    const row = await this.productRepository.updateOptionGroup({
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
    const current =
      await this.productRepository.findOptionGroupById(optionGroupId);
    if (!current || current.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Option group not found.');
    }

    await this.productRepository.softDeleteOptionGroup(optionGroupId);
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

    const product =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!product) throw new NotFoundException('Product not found.');

    const groups =
      await this.productRepository.listOptionGroupsByProduct(productId);
    if (groups.length !== optionGroupIds.length) {
      throw new BadRequestException('optionGroupIds length mismatch.');
    }

    const idSet = new Set(groups.map((g) => g.id.toString()));
    for (const id of optionGroupIds) {
      if (!idSet.has(id.toString())) {
        throw new BadRequestException('Invalid optionGroupIds.');
      }
    }

    const rows = await this.productRepository.reorderOptionGroups({
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
    const group =
      await this.productRepository.findOptionGroupById(optionGroupId);

    if (!group || group.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Option group not found.');
    }

    const row = await this.productRepository.createOptionItem({
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

    const current =
      await this.productRepository.findOptionItemById(optionItemId);
    if (!current || current.option_group.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Option item not found.');
    }

    const row = await this.productRepository.updateOptionItem({
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
    const current =
      await this.productRepository.findOptionItemById(optionItemId);
    if (!current || current.option_group.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Option item not found.');
    }

    await this.productRepository.softDeleteOptionItem(optionItemId);
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

    const group =
      await this.productRepository.findOptionGroupById(optionGroupId);
    if (!group || group.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Option group not found.');
    }

    const items =
      await this.productRepository.listOptionItemsByGroup(optionGroupId);
    if (items.length !== optionItemIds.length) {
      throw new BadRequestException('optionItemIds length mismatch.');
    }

    const idSet = new Set(items.map((item) => item.id.toString()));
    for (const id of optionItemIds) {
      if (!idSet.has(id.toString())) {
        throw new BadRequestException('Invalid optionItemIds.');
      }
    }

    const rows = await this.productRepository.reorderOptionItems({
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

    const product =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!product) throw new NotFoundException('Product not found.');

    const row = await this.productRepository.upsertProductCustomTemplate({
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

    const template =
      await this.productRepository.findCustomTemplateById(templateId);
    if (!template || template.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Custom template not found.');
    }

    const row = await this.productRepository.setCustomTemplateActive(
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

    const template =
      await this.productRepository.findCustomTemplateById(templateId);
    if (!template || template.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Custom template not found.');
    }

    if (tokenId) {
      const token =
        await this.productRepository.findCustomTextTokenById(tokenId);
      if (!token || token.template.product.store_id !== ctx.storeId) {
        throw new NotFoundException('Custom text token not found.');
      }
    }

    const row = await this.productRepository.upsertCustomTextToken({
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
    const token = await this.productRepository.findCustomTextTokenById(tokenId);
    if (!token || token.template.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Custom text token not found.');
    }

    await this.productRepository.softDeleteCustomTextToken(tokenId);
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

    const template =
      await this.productRepository.findCustomTemplateById(templateId);
    if (!template || template.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Custom template not found.');
    }

    const tokens =
      await this.productRepository.listCustomTextTokens(templateId);
    if (tokens.length !== tokenIds.length) {
      throw new BadRequestException('tokenIds length mismatch.');
    }

    const idSet = new Set(tokens.map((token) => token.id.toString()));
    for (const id of tokenIds) {
      if (!idSet.has(id.toString())) {
        throw new BadRequestException('Invalid tokenIds.');
      }
    }

    const rows = await this.productRepository.reorderCustomTextTokens({
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
}
