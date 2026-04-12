import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/prisma';

@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaService) {}
  async listProductsByStore(args: {
    storeId: bigint;
    limit: number;
    cursor?: bigint;
    isActive?: boolean;
    categoryId?: bigint;
    search?: string;
  }) {
    return this.prisma.product.findMany({
      where: {
        store_id: args.storeId,
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...(args.isActive !== undefined ? { is_active: args.isActive } : {}),
        ...(args.categoryId
          ? {
              product_categories: {
                some: {
                  category_id: args.categoryId,
                },
              },
            }
          : {}),
        ...(args.search
          ? {
              OR: [
                { name: { contains: args.search } },
                {
                  product_tags: {
                    some: {
                      tag: {
                        name: { contains: args.search },
                      },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        images: { orderBy: { sort_order: 'asc' } },
        product_categories: {
          include: {
            category: true,
          },
        },
        product_tags: {
          include: {
            tag: true,
          },
        },
        option_groups: {
          orderBy: { sort_order: 'asc' },
          include: {
            option_items: {
              orderBy: { sort_order: 'asc' },
            },
          },
        },
        custom_template: {
          include: {
            text_tokens: {
              orderBy: { sort_order: 'asc' },
            },
          },
        },
      },
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  async findProductById(args: { productId: bigint; storeId: bigint }) {
    return this.prisma.product.findFirst({
      where: {
        id: args.productId,
        store_id: args.storeId,
        is_active: true,
      },
      include: {
        images: { orderBy: { sort_order: 'asc' } },
        product_categories: {
          include: {
            category: true,
          },
        },
        product_tags: {
          include: {
            tag: true,
          },
        },
        option_groups: {
          orderBy: { sort_order: 'asc' },
          include: {
            option_items: {
              orderBy: { sort_order: 'asc' },
            },
          },
        },
        custom_template: {
          include: {
            text_tokens: {
              orderBy: { sort_order: 'asc' },
            },
          },
        },
      },
    });
  }

  async findProductByIdIncludingInactive(args: {
    productId: bigint;
    storeId: bigint;
  }) {
    return this.prisma.product.findFirst({
      where: {
        id: args.productId,
        store_id: args.storeId,
      },
      include: {
        images: { orderBy: { sort_order: 'asc' } },
        product_categories: {
          include: {
            category: true,
          },
        },
        product_tags: {
          include: {
            tag: true,
          },
        },
        option_groups: {
          orderBy: { sort_order: 'asc' },
          include: {
            option_items: {
              orderBy: { sort_order: 'asc' },
            },
          },
        },
        custom_template: {
          include: {
            text_tokens: {
              orderBy: { sort_order: 'asc' },
            },
          },
        },
      },
    });
  }

  async createProduct(args: {
    storeId: bigint;
    data: Omit<Prisma.ProductUncheckedCreateInput, 'store_id'>;
  }) {
    return this.prisma.product.create({
      data: {
        store_id: args.storeId,
        ...args.data,
      },
    });
  }

  async updateProduct(args: {
    productId: bigint;
    data: Prisma.ProductUpdateInput;
  }) {
    return this.prisma.product.update({
      where: { id: args.productId },
      data: args.data,
    });
  }

  async softDeleteProduct(productId: bigint): Promise<void> {
    await this.prisma.product.update({
      where: { id: productId },
      data: {
        deleted_at: new Date(),
        is_active: false,
      },
    });
  }

  async countProductImages(productId: bigint): Promise<number> {
    return this.prisma.productImage.count({
      where: { product_id: productId },
    });
  }

  async addProductImage(args: {
    productId: bigint;
    imageUrl: string;
    sortOrder: number;
  }) {
    return this.prisma.productImage.create({
      data: {
        product_id: args.productId,
        image_url: args.imageUrl,
        sort_order: args.sortOrder,
      },
    });
  }

  async findProductImageById(imageId: bigint) {
    return this.prisma.productImage.findFirst({
      where: { id: imageId },
      include: {
        product: {
          select: {
            id: true,
            store_id: true,
          },
        },
      },
    });
  }

  async listProductImages(productId: bigint) {
    return this.prisma.productImage.findMany({
      where: {
        product_id: productId,
      },
      orderBy: { sort_order: 'asc' },
    });
  }

  async softDeleteProductImage(imageId: bigint): Promise<void> {
    await this.prisma.productImage.update({
      where: { id: imageId },
      data: { deleted_at: new Date() },
    });
  }

  async reorderProductImages(args: { productId: bigint; imageIds: bigint[] }) {
    return this.prisma.$transaction(async (tx) => {
      await Promise.all(
        args.imageIds.map((id, index) =>
          tx.productImage.update({
            where: { id },
            data: { sort_order: index },
          }),
        ),
      );

      return tx.productImage.findMany({
        where: {
          product_id: args.productId,
        },
        orderBy: { sort_order: 'asc' },
      });
    });
  }

  async findCategoryIds(ids: bigint[]) {
    return this.prisma.category.findMany({
      where: {
        id: { in: ids },
      },
      select: { id: true },
    });
  }

  async findTagIds(ids: bigint[]) {
    return this.prisma.tag.findMany({
      where: {
        id: { in: ids },
      },
      select: { id: true },
    });
  }

  async replaceProductCategories(args: {
    productId: bigint;
    categoryIds: bigint[];
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.productCategory.deleteMany({
        where: {
          product_id: args.productId,
        },
      });

      if (args.categoryIds.length > 0) {
        await tx.productCategory.createMany({
          data: args.categoryIds.map((categoryId) => ({
            product_id: args.productId,
            category_id: categoryId,
          })),
          skipDuplicates: true,
        });
      }
    });
  }

  async replaceProductTags(args: {
    productId: bigint;
    tagIds: bigint[];
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.productTag.deleteMany({
        where: {
          product_id: args.productId,
        },
      });

      if (args.tagIds.length > 0) {
        await tx.productTag.createMany({
          data: args.tagIds.map((tagId) => ({
            product_id: args.productId,
            tag_id: tagId,
          })),
          skipDuplicates: true,
        });
      }
    });
  }

  async createOptionGroup(args: {
    productId: bigint;
    data: Omit<Prisma.ProductOptionGroupUncheckedCreateInput, 'product_id'>;
  }) {
    return this.prisma.productOptionGroup.create({
      data: {
        product_id: args.productId,
        ...args.data,
      },
      include: {
        option_items: {
          orderBy: { sort_order: 'asc' },
        },
      },
    });
  }

  async findOptionGroupById(id: bigint) {
    return this.prisma.productOptionGroup.findFirst({
      where: { id },
      include: {
        product: {
          select: {
            id: true,
            store_id: true,
          },
        },
        option_items: {
          orderBy: { sort_order: 'asc' },
        },
      },
    });
  }

  async updateOptionGroup(args: {
    optionGroupId: bigint;
    data: Prisma.ProductOptionGroupUpdateInput;
  }) {
    return this.prisma.productOptionGroup.update({
      where: { id: args.optionGroupId },
      data: args.data,
      include: {
        option_items: {
          orderBy: { sort_order: 'asc' },
        },
      },
    });
  }

  async softDeleteOptionGroup(optionGroupId: bigint): Promise<void> {
    await this.prisma.productOptionGroup.update({
      where: { id: optionGroupId },
      data: {
        deleted_at: new Date(),
        is_active: false,
      },
    });
  }

  async listOptionGroupsByProduct(productId: bigint) {
    return this.prisma.productOptionGroup.findMany({
      where: { product_id: productId },
      orderBy: { sort_order: 'asc' },
      include: {
        option_items: {
          orderBy: { sort_order: 'asc' },
        },
      },
    });
  }

  async reorderOptionGroups(args: {
    productId: bigint;
    optionGroupIds: bigint[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      await Promise.all(
        args.optionGroupIds.map((id, index) =>
          tx.productOptionGroup.update({
            where: { id },
            data: { sort_order: index },
          }),
        ),
      );

      return tx.productOptionGroup.findMany({
        where: { product_id: args.productId },
        orderBy: { sort_order: 'asc' },
        include: {
          option_items: {
            orderBy: { sort_order: 'asc' },
          },
        },
      });
    });
  }

  async createOptionItem(args: {
    optionGroupId: bigint;
    data: Omit<Prisma.ProductOptionItemUncheckedCreateInput, 'option_group_id'>;
  }) {
    return this.prisma.productOptionItem.create({
      data: {
        option_group_id: args.optionGroupId,
        ...args.data,
      },
    });
  }

  async findOptionItemById(id: bigint) {
    return this.prisma.productOptionItem.findFirst({
      where: { id },
      include: {
        option_group: {
          include: {
            product: {
              select: {
                id: true,
                store_id: true,
              },
            },
          },
        },
      },
    });
  }

  async updateOptionItem(args: {
    optionItemId: bigint;
    data: Prisma.ProductOptionItemUpdateInput;
  }) {
    return this.prisma.productOptionItem.update({
      where: { id: args.optionItemId },
      data: args.data,
    });
  }

  async softDeleteOptionItem(optionItemId: bigint): Promise<void> {
    await this.prisma.productOptionItem.update({
      where: { id: optionItemId },
      data: {
        deleted_at: new Date(),
        is_active: false,
      },
    });
  }

  async listOptionItemsByGroup(optionGroupId: bigint) {
    return this.prisma.productOptionItem.findMany({
      where: { option_group_id: optionGroupId },
      orderBy: { sort_order: 'asc' },
    });
  }

  async reorderOptionItems(args: {
    optionGroupId: bigint;
    optionItemIds: bigint[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      await Promise.all(
        args.optionItemIds.map((id, index) =>
          tx.productOptionItem.update({
            where: { id },
            data: { sort_order: index },
          }),
        ),
      );

      return tx.productOptionItem.findMany({
        where: { option_group_id: args.optionGroupId },
        orderBy: { sort_order: 'asc' },
      });
    });
  }

  async upsertProductCustomTemplate(args: {
    productId: bigint;
    baseImageUrl: string;
    isActive: boolean;
  }) {
    return this.prisma.productCustomTemplate.upsert({
      where: {
        product_id: args.productId,
      },
      create: {
        product_id: args.productId,
        base_image_url: args.baseImageUrl,
        is_active: args.isActive,
      },
      update: {
        base_image_url: args.baseImageUrl,
        is_active: args.isActive,
      },
      include: {
        text_tokens: {
          orderBy: { sort_order: 'asc' },
        },
      },
    });
  }

  async findCustomTemplateById(id: bigint) {
    return this.prisma.productCustomTemplate.findFirst({
      where: { id },
      include: {
        product: {
          select: {
            id: true,
            store_id: true,
          },
        },
        text_tokens: {
          orderBy: { sort_order: 'asc' },
        },
      },
    });
  }

  async setCustomTemplateActive(templateId: bigint, isActive: boolean) {
    return this.prisma.productCustomTemplate.update({
      where: { id: templateId },
      data: {
        is_active: isActive,
      },
      include: {
        text_tokens: {
          orderBy: { sort_order: 'asc' },
        },
      },
    });
  }

  async upsertCustomTextToken(args: {
    tokenId?: bigint;
    templateId: bigint;
    tokenKey: string;
    defaultText: string;
    maxLength: number;
    sortOrder: number;
    isRequired: boolean;
    posX: number | null;
    posY: number | null;
    width: number | null;
    height: number | null;
  }) {
    if (args.tokenId) {
      return this.prisma.productCustomTextToken.update({
        where: { id: args.tokenId },
        data: {
          token_key: args.tokenKey,
          default_text: args.defaultText,
          max_length: args.maxLength,
          sort_order: args.sortOrder,
          is_required: args.isRequired,
          pos_x: args.posX,
          pos_y: args.posY,
          width: args.width,
          height: args.height,
        },
      });
    }

    return this.prisma.productCustomTextToken.create({
      data: {
        template_id: args.templateId,
        token_key: args.tokenKey,
        default_text: args.defaultText,
        max_length: args.maxLength,
        sort_order: args.sortOrder,
        is_required: args.isRequired,
        pos_x: args.posX,
        pos_y: args.posY,
        width: args.width,
        height: args.height,
      },
    });
  }

  async findCustomTextTokenById(id: bigint) {
    return this.prisma.productCustomTextToken.findFirst({
      where: { id },
      include: {
        template: {
          include: {
            product: {
              select: {
                id: true,
                store_id: true,
              },
            },
          },
        },
      },
    });
  }

  async softDeleteCustomTextToken(id: bigint): Promise<void> {
    await this.prisma.productCustomTextToken.update({
      where: { id },
      data: {
        deleted_at: new Date(),
      },
    });
  }

  async listCustomTextTokens(templateId: bigint) {
    return this.prisma.productCustomTextToken.findMany({
      where: {
        template_id: templateId,
      },
      orderBy: { sort_order: 'asc' },
    });
  }

  async reorderCustomTextTokens(args: {
    templateId: bigint;
    tokenIds: bigint[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      await Promise.all(
        args.tokenIds.map((id, index) =>
          tx.productCustomTextToken.update({
            where: { id },
            data: { sort_order: index },
          }),
        ),
      );

      return tx.productCustomTextToken.findMany({
        where: {
          template_id: args.templateId,
        },
        orderBy: { sort_order: 'asc' },
      });
    });
  }

  async findActiveProduct(productId: bigint): Promise<{ id: bigint } | null> {
    return this.prisma.product.findFirst({
      where: {
        id: productId,
        is_active: true,
      },
      select: { id: true },
    });
  }

  async findProductOwnership(args: { productId: bigint; storeId: bigint }) {
    return this.prisma.product.findFirst({
      where: {
        id: args.productId,
        store_id: args.storeId,
      },
      select: {
        id: true,
      },
    });
  }
}
