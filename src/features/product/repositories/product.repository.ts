import { Injectable } from '@nestjs/common';
import { type CategoryType, Prisma } from '@prisma/client';

import { PrismaService } from '@/prisma';

/** 구매자 매장 상품 카드 row. product-storefront 매퍼 입력. */
export interface StoreProductRow {
  id: bigint;
  name: string;
  description: string | null;
  regular_price: number;
  sale_price: number | null;
  currency: string;
  images: { image_url: string }[];
  product_categories: { category_id: bigint }[];
}

/** 매장 상품 카테고리(사이드바) row. */
export interface StoreProductCategoryRow {
  id: bigint;
  name: string;
  category_type: CategoryType;
  sort_order: number;
  product_count: number;
}

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

  /**
   * active product가 존재하는지(soft-delete 아님 + 매장도 active/soft-delete 아님) 가벼운 검증.
   * 판매 가능한 상품인지 확인하는 용도. 다른 도메인(wishlist, cart 등)에서 활용.
   */
  async existsActiveProduct(productId: bigint): Promise<boolean> {
    const found = await this.prisma.product.findFirst({
      where: {
        id: productId,
        is_active: true,
        deleted_at: null,
        store: { is_active: true, deleted_at: null },
      },
      select: { id: true },
    });
    return Boolean(found);
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

  /**
   * 구매자용 매장 상품 목록. 활성 상품(+활성 매장)만, 카테고리/검색 필터.
   * 카드용 가벼운 select(대표 이미지 1장 + 카테고리 id). 커서는 id < cursor(desc).
   */
  async listActiveProductsByStore(args: {
    storeId: bigint;
    limit: number;
    cursor?: bigint;
    categoryId?: bigint;
    search?: string;
  }): Promise<StoreProductRow[]> {
    return this.prisma.product.findMany({
      where: {
        store_id: args.storeId,
        is_active: true,
        deleted_at: null,
        store: { is_active: true, deleted_at: null },
        ...(args.cursor ? { id: { lt: args.cursor } } : {}),
        ...(args.categoryId
          ? {
              product_categories: {
                some: { category_id: args.categoryId, deleted_at: null },
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
                      deleted_at: null,
                      tag: { name: { contains: args.search } },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        description: true,
        regular_price: true,
        sale_price: true,
        currency: true,
        images: {
          where: { deleted_at: null },
          orderBy: { sort_order: 'asc' },
          take: 1,
          select: { image_url: true },
        },
        product_categories: {
          where: { deleted_at: null },
          select: { category_id: true },
        },
      },
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  /**
   * 매장이 보유한 활성 상품의 카테고리(사이드바). 빈 카테고리 제외.
   * sort_order asc, productCount는 이 매장의 활성 상품 기준.
   */
  async listStoreProductCategories(
    storeId: bigint,
  ): Promise<StoreProductCategoryRow[]> {
    const grouped = await this.prisma.productCategory.groupBy({
      by: ['category_id'],
      where: {
        deleted_at: null,
        product: { store_id: storeId, is_active: true, deleted_at: null },
      },
      _count: { _all: true },
    });
    if (grouped.length === 0) return [];

    const countByCategory = new Map(
      grouped.map((g) => [g.category_id, g._count._all]),
    );
    const categories = await this.prisma.category.findMany({
      where: {
        id: { in: grouped.map((g) => g.category_id) },
        is_active: true,
        deleted_at: null,
      },
      select: {
        id: true,
        name: true,
        category_type: true,
        sort_order: true,
      },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    });

    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      category_type: category.category_type,
      sort_order: category.sort_order,
      product_count: countByCategory.get(category.id) ?? 0,
    }));
  }
}
