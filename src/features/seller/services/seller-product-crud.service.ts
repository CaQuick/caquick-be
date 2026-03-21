import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditActionType, AuditTargetType, Prisma } from '@prisma/client';

import { parseId } from '../../../common/utils/id-parser';
import {
  cleanNullableText,
  cleanRequiredText,
} from '../../../common/utils/text-cleaner';
import { ProductRepository } from '../../product';
import {
  IMAGE_LIMIT_EXCEEDED,
  IMAGE_MIN_REQUIRED,
  idsMismatchError,
  invalidIdsError,
  PRODUCT_IMAGE_NOT_FOUND,
  PRODUCT_NOT_FOUND,
  SALE_PRICE_EXCEEDS_REGULAR,
} from '../constants/seller-error-messages';
import {
  DEFAULT_PREPARATION_TIME_MINUTES,
  MAX_PRODUCT_DESCRIPTION_LENGTH,
  MAX_PRODUCT_IMAGES,
  MAX_PRODUCT_NAME_LENGTH,
  MAX_PRODUCT_PRICE,
  MAX_PRODUCT_PURCHASE_NOTICE_LENGTH,
  MAX_URL_LENGTH,
  MIN_PRODUCT_IMAGES,
  MIN_PRODUCT_PRICE,
  MIN_SALE_PRICE,
} from '../constants/seller.constants';
import {
  nextCursorOf,
  normalizeCursorInput,
  SellerRepository,
} from '../repositories/seller.repository';
import type {
  SellerAddProductImageInput,
  SellerCreateProductInput,
  SellerProductListInput,
  SellerReorderProductImagesInput,
  SellerSetProductActiveInput,
  SellerSetProductCategoriesInput,
  SellerSetProductTagsInput,
  SellerUpdateProductInput,
} from '../types/seller-input.type';
import type {
  SellerCursorConnection,
  SellerProductImageOutput,
  SellerProductOutput,
} from '../types/seller-output.type';

import { SellerBaseService } from './seller-base.service';

interface ProductOptionGroupRow {
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
}

interface ProductCustomTemplateRow {
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
}

interface ProductDetailRow {
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
  option_groups: ProductOptionGroupRow[];
  custom_template: ProductCustomTemplateRow | null;
}

@Injectable()
export class SellerProductCrudService extends SellerBaseService {
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
      cursor: input?.cursor ? parseId(input.cursor) : null,
    });

    const rows = await this.productRepository.listProductsByStore({
      storeId: ctx.storeId,
      limit: normalized.limit,
      cursor: normalized.cursor,
      isActive: input?.isActive ?? true,
      categoryId: input?.categoryId ? parseId(input.categoryId) : undefined,
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

    if (!row) throw new NotFoundException(PRODUCT_NOT_FOUND);
    return this.toProductOutput(row);
  }

  async sellerCreateProduct(
    accountId: bigint,
    input: SellerCreateProductInput,
  ): Promise<SellerProductOutput> {
    const ctx = await this.requireSellerContext(accountId);

    this.validateProductPrices(input.regularPrice, input.salePrice);

    const created = await this.productRepository.createProduct({
      storeId: ctx.storeId,
      data: {
        name: cleanRequiredText(input.name, MAX_PRODUCT_NAME_LENGTH),
        description: cleanNullableText(
          input.description,
          MAX_PRODUCT_DESCRIPTION_LENGTH,
        ),
        purchase_notice: cleanNullableText(
          input.purchaseNotice,
          MAX_PRODUCT_PURCHASE_NOTICE_LENGTH,
        ),
        regular_price: input.regularPrice,
        sale_price: input.salePrice ?? null,
        currency: this.cleanCurrency(input.currency),
        base_design_image_url: cleanNullableText(
          input.baseDesignImageUrl,
          MAX_URL_LENGTH,
        ),
        preparation_time_minutes:
          input.preparationTimeMinutes ?? DEFAULT_PREPARATION_TIME_MINUTES,
        is_active: input.isActive ?? true,
      },
    });

    await this.productRepository.addProductImage({
      productId: created.id,
      imageUrl: cleanRequiredText(input.initialImageUrl, MAX_URL_LENGTH),
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
    if (!detail) throw new NotFoundException(PRODUCT_NOT_FOUND);
    return this.toProductOutput(detail);
  }

  async sellerUpdateProduct(
    accountId: bigint,
    input: SellerUpdateProductInput,
  ): Promise<SellerProductOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = parseId(input.productId);

    const current =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!current) throw new NotFoundException(PRODUCT_NOT_FOUND);

    const data = this.buildProductUpdateData(input);
    this.validateProductPrices(
      data.regular_price as number | undefined,
      data.sale_price as number | null | undefined,
    );

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
    if (!detail) throw new NotFoundException(PRODUCT_NOT_FOUND);

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
    if (!current) throw new NotFoundException(PRODUCT_NOT_FOUND);

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
    const productId = parseId(input.productId);

    const current =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!current) throw new NotFoundException(PRODUCT_NOT_FOUND);

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
    if (!detail) throw new NotFoundException(PRODUCT_NOT_FOUND);
    return this.toProductOutput(detail);
  }

  async sellerAddProductImage(
    accountId: bigint,
    input: SellerAddProductImageInput,
  ): Promise<SellerProductImageOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = parseId(input.productId);

    const product =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!product) throw new NotFoundException(PRODUCT_NOT_FOUND);

    const count = await this.productRepository.countProductImages(productId);
    if (count >= MAX_PRODUCT_IMAGES) {
      throw new BadRequestException(IMAGE_LIMIT_EXCEEDED);
    }

    const row = await this.productRepository.addProductImage({
      productId,
      imageUrl: cleanRequiredText(input.imageUrl, MAX_URL_LENGTH),
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
      throw new NotFoundException(PRODUCT_IMAGE_NOT_FOUND);
    }

    const count = await this.productRepository.countProductImages(
      image.product_id,
    );
    if (count <= MIN_PRODUCT_IMAGES) {
      throw new BadRequestException(IMAGE_MIN_REQUIRED);
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
    const productId = parseId(input.productId);
    const imageIds = this.parseIdList(input.imageIds);

    const product =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!product) throw new NotFoundException(PRODUCT_NOT_FOUND);

    const existing = await this.productRepository.listProductImages(productId);
    if (existing.length !== imageIds.length) {
      throw new BadRequestException(idsMismatchError('imageIds'));
    }

    const existingSet = new Set(existing.map((row) => row.id.toString()));
    for (const id of imageIds) {
      if (!existingSet.has(id.toString())) {
        throw new BadRequestException(invalidIdsError('imageIds'));
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
    const productId = parseId(input.productId);

    const product =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!product) throw new NotFoundException(PRODUCT_NOT_FOUND);

    const categoryIds = this.parseIdList(input.categoryIds);
    const categories =
      await this.productRepository.findCategoryIds(categoryIds);
    if (categories.length !== categoryIds.length) {
      throw new BadRequestException(invalidIdsError('categoryIds'));
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
    if (!detail) throw new NotFoundException(PRODUCT_NOT_FOUND);

    return this.toProductOutput(detail);
  }

  async sellerSetProductTags(
    accountId: bigint,
    input: SellerSetProductTagsInput,
  ): Promise<SellerProductOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = parseId(input.productId);

    const product =
      await this.productRepository.findProductByIdIncludingInactive({
        productId,
        storeId: ctx.storeId,
      });
    if (!product) throw new NotFoundException(PRODUCT_NOT_FOUND);

    const tagIds = this.parseIdList(input.tagIds);
    const tags = await this.productRepository.findTagIds(tagIds);
    if (tags.length !== tagIds.length) {
      throw new BadRequestException(invalidIdsError('tagIds'));
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
    if (!detail) throw new NotFoundException(PRODUCT_NOT_FOUND);

    return this.toProductOutput(detail);
  }

  private toProductOutput(row: ProductDetailRow): SellerProductOutput {
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

  private toOptionGroupOutput(g: ProductOptionGroupRow) {
    return {
      id: g.id.toString(),
      productId: g.product_id.toString(),
      name: g.name,
      isRequired: g.is_required,
      minSelect: g.min_select,
      maxSelect: g.max_select,
      optionRequiresDescription: g.option_requires_description,
      optionRequiresImage: g.option_requires_image,
      sortOrder: g.sort_order,
      isActive: g.is_active,
      optionItems: g.option_items.map((item) => ({
        id: item.id.toString(),
        optionGroupId: item.option_group_id.toString(),
        title: item.title,
        description: item.description,
        imageUrl: item.image_url,
        priceDelta: item.price_delta,
        sortOrder: item.sort_order,
        isActive: item.is_active,
      })),
    };
  }

  private toCustomTemplateOutput(t: ProductCustomTemplateRow) {
    return {
      id: t.id.toString(),
      productId: t.product_id.toString(),
      baseImageUrl: t.base_image_url,
      isActive: t.is_active,
      textTokens: t.text_tokens.map((token) => ({
        id: token.id.toString(),
        templateId: token.template_id.toString(),
        tokenKey: token.token_key,
        defaultText: token.default_text,
        maxLength: token.max_length,
        sortOrder: token.sort_order,
        isRequired: token.is_required,
        posX: token.pos_x,
        posY: token.pos_y,
        width: token.width,
        height: token.height,
      })),
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

  private validateProductPrices(
    regularPrice?: number,
    salePrice?: number | null,
  ): void {
    if (regularPrice !== undefined) {
      this.assertPositiveRange(
        regularPrice,
        MIN_PRODUCT_PRICE,
        MAX_PRODUCT_PRICE,
        'regularPrice',
      );
    }

    if (salePrice !== undefined && salePrice !== null) {
      this.assertPositiveRange(
        salePrice,
        MIN_SALE_PRICE,
        MAX_PRODUCT_PRICE,
        'salePrice',
      );
      if (regularPrice !== undefined && salePrice > regularPrice) {
        throw new BadRequestException(SALE_PRICE_EXCEEDS_REGULAR);
      }
    }
  }

  private buildProductUpdateData(
    input: SellerUpdateProductInput,
  ): Prisma.ProductUpdateInput {
    return {
      ...(input.name !== undefined
        ? { name: cleanRequiredText(input.name, MAX_PRODUCT_NAME_LENGTH) }
        : {}),
      ...(input.description !== undefined
        ? {
            description: cleanNullableText(
              input.description,
              MAX_PRODUCT_DESCRIPTION_LENGTH,
            ),
          }
        : {}),
      ...(input.purchaseNotice !== undefined
        ? {
            purchase_notice: cleanNullableText(
              input.purchaseNotice,
              MAX_PRODUCT_PURCHASE_NOTICE_LENGTH,
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
            base_design_image_url: cleanNullableText(
              input.baseDesignImageUrl,
              MAX_URL_LENGTH,
            ),
          }
        : {}),
      ...(input.preparationTimeMinutes !== undefined &&
      input.preparationTimeMinutes !== null
        ? { preparation_time_minutes: input.preparationTimeMinutes }
        : {}),
    };
  }
}
