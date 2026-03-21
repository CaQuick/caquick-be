import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditActionType, AuditTargetType } from '@prisma/client';

import { parseId } from '../../../common/utils/id-parser';
import {
  cleanNullableText,
  cleanRequiredText,
} from '../../../common/utils/text-cleaner';
import { ProductRepository } from '../../product';
import {
  MAX_OPTION_GROUP_NAME_LENGTH,
  MAX_OPTION_ITEM_DESCRIPTION_LENGTH,
  MAX_OPTION_ITEM_TITLE_LENGTH,
  MAX_URL_LENGTH,
} from '../constants/seller.constants';
import { SellerRepository } from '../repositories/seller.repository';
import type {
  SellerCreateOptionGroupInput,
  SellerCreateOptionItemInput,
  SellerReorderOptionGroupsInput,
  SellerReorderOptionItemsInput,
  SellerUpdateOptionGroupInput,
  SellerUpdateOptionItemInput,
} from '../types/seller-input.type';
import type {
  SellerOptionGroupOutput,
  SellerOptionItemOutput,
} from '../types/seller-output.type';

import { SellerBaseService } from './seller-base.service';

@Injectable()
export class SellerOptionService extends SellerBaseService {
  constructor(
    repo: SellerRepository,
    private readonly productRepository: ProductRepository,
  ) {
    super(repo);
  }

  async sellerCreateOptionGroup(
    accountId: bigint,
    input: SellerCreateOptionGroupInput,
  ): Promise<SellerOptionGroupOutput> {
    const ctx = await this.requireSellerContext(accountId);
    const productId = parseId(input.productId);

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
        name: cleanRequiredText(input.name, MAX_OPTION_GROUP_NAME_LENGTH),
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
    const optionGroupId = parseId(input.optionGroupId);

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
          ? {
              name: cleanRequiredText(input.name, MAX_OPTION_GROUP_NAME_LENGTH),
            }
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
    const productId = parseId(input.productId);
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
    const optionGroupId = parseId(input.optionGroupId);
    const group =
      await this.productRepository.findOptionGroupById(optionGroupId);

    if (!group || group.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Option group not found.');
    }

    const row = await this.productRepository.createOptionItem({
      optionGroupId,
      data: {
        title: cleanRequiredText(input.title, MAX_OPTION_ITEM_TITLE_LENGTH),
        description: cleanNullableText(
          input.description,
          MAX_OPTION_ITEM_DESCRIPTION_LENGTH,
        ),
        image_url: cleanNullableText(input.imageUrl, MAX_URL_LENGTH),
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
    const optionItemId = parseId(input.optionItemId);

    const current =
      await this.productRepository.findOptionItemById(optionItemId);
    if (!current || current.option_group.product.store_id !== ctx.storeId) {
      throw new NotFoundException('Option item not found.');
    }

    const row = await this.productRepository.updateOptionItem({
      optionItemId,
      data: {
        ...(input.title !== undefined
          ? {
              title: cleanRequiredText(
                input.title,
                MAX_OPTION_ITEM_TITLE_LENGTH,
              ),
            }
          : {}),
        ...(input.description !== undefined
          ? {
              description: cleanNullableText(
                input.description,
                MAX_OPTION_ITEM_DESCRIPTION_LENGTH,
              ),
            }
          : {}),
        ...(input.imageUrl !== undefined
          ? {
              image_url: cleanNullableText(input.imageUrl, MAX_URL_LENGTH),
            }
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
    const optionGroupId = parseId(input.optionGroupId);
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
}
