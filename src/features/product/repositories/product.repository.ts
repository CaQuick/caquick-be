import { Injectable } from '@nestjs/common';
import {
  type BannerLinkType,
  type CategoryType,
  Prisma,
} from '@prisma/client';

import { RANKING_VALID_ORDER_STATUSES } from '@/features/store';
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

/** 인기 케이크 랭킹 후보 row. product-home 매퍼 입력. */
export interface CakeCandidateRow {
  id: bigint;
  name: string;
  regular_price: number;
  sale_price: number | null;
  images: { image_url: string }[];
  store: {
    store_name: string;
    address_city: string | null;
    address_neighborhood: string | null;
    region: { name: string } | null;
  };
}

/** 홈 배너 row. */
export interface HomeBannerRow {
  id: bigint;
  image_url: string;
  title: string | null;
  link_type: BannerLinkType;
  link_url: string | null;
  link_product_id: bigint | null;
  link_store_id: bigint | null;
  link_category_id: bigint | null;
}

/** 상품별 평균 평점·리뷰 수. */
export interface ProductReviewStat {
  average: number;
  count: number;
}

/** 구매자 상품 상세 row. product-detail 매퍼 입력. */
export interface ProductDetailRow {
  id: bigint;
  store_id: bigint;
  name: string;
  description: string | null;
  purchase_notice: string | null;
  regular_price: number;
  sale_price: number | null;
  currency: string;
  images: { image_url: string }[];
  option_groups: {
    id: bigint;
    name: string;
    description: string | null;
    is_required: boolean;
    min_select: number;
    max_select: number;
    sort_order: number;
    option_items: {
      id: bigint;
      title: string;
      description: string | null;
      image_url: string | null;
      price_delta: number;
      sort_order: number;
    }[];
  }[];
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
      // soft-delete extension은 root만 patch하므로 nested relation에 가드를 명시한다
      include: {
        images: {
          where: { deleted_at: null },
          orderBy: { sort_order: 'asc' },
        },
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
          where: { deleted_at: null },
          orderBy: { sort_order: 'asc' },
          include: {
            option_items: {
              where: { deleted_at: null },
              orderBy: { sort_order: 'asc' },
            },
          },
        },
        custom_template: {
          include: {
            text_tokens: {
              where: { deleted_at: null },
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
      // soft-delete extension은 root만 patch하므로 nested relation에 가드를 명시한다
      include: {
        images: {
          where: { deleted_at: null },
          orderBy: { sort_order: 'asc' },
        },
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
          where: { deleted_at: null },
          orderBy: { sort_order: 'asc' },
          include: {
            option_items: {
              where: { deleted_at: null },
              orderBy: { sort_order: 'asc' },
            },
          },
        },
        custom_template: {
          include: {
            text_tokens: {
              where: { deleted_at: null },
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
      // soft-delete extension은 root만 patch하므로 nested relation에 가드를 명시한다
      include: {
        images: {
          where: { deleted_at: null },
          orderBy: { sort_order: 'asc' },
        },
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
          where: { deleted_at: null },
          orderBy: { sort_order: 'asc' },
          include: {
            option_items: {
              where: { deleted_at: null },
              orderBy: { sort_order: 'asc' },
            },
          },
        },
        custom_template: {
          include: {
            text_tokens: {
              where: { deleted_at: null },
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
        // 0n도 유효한 인자로 다뤄야 한다(parseId("0")=0n). truthiness 체크는 0n을
        // falsy로 떨궈 잘못된 필터를 전체조회로 만들므로 undefined로만 분기한다.
        ...(args.cursor !== undefined ? { id: { lt: args.cursor } } : {}),
        ...(args.categoryId !== undefined
          ? {
              product_categories: {
                some: {
                  category_id: args.categoryId,
                  deleted_at: null,
                  category: { is_active: true, deleted_at: null },
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
                      deleted_at: null,
                      tag: {
                        name: { contains: args.search },
                        deleted_at: null,
                      },
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
          // storeProductCategories와 동일하게 비활성/삭제 카테고리는 categoryIds에서 제외
          where: {
            deleted_at: null,
            category: { is_active: true, deleted_at: null },
          },
          select: { category_id: true },
        },
      },
      orderBy: { id: 'desc' },
      take: args.limit + 1,
    });
  }

  /**
   * 구매자 상품 상세. 활성 상품(+활성 매장)만. 이미지·옵션 그룹/아이템 포함.
   * nested relation은 soft-delete extension이 root만 patch하므로 가드를 명시한다.
   */
  async findProductDetailById(
    productId: bigint,
  ): Promise<ProductDetailRow | null> {
    return this.prisma.product.findFirst({
      where: {
        id: productId,
        is_active: true,
        deleted_at: null,
        store: { is_active: true, deleted_at: null },
      },
      select: {
        id: true,
        store_id: true,
        name: true,
        description: true,
        purchase_notice: true,
        regular_price: true,
        sale_price: true,
        currency: true,
        images: {
          where: { deleted_at: null },
          orderBy: { sort_order: 'asc' },
          select: { image_url: true },
        },
        option_groups: {
          where: { is_active: true, deleted_at: null },
          orderBy: { sort_order: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            is_required: true,
            min_select: true,
            max_select: true,
            sort_order: true,
            option_items: {
              where: { is_active: true, deleted_at: null },
              orderBy: { sort_order: 'asc' },
              select: {
                id: true,
                title: true,
                description: true,
                image_url: true,
                price_delta: true,
                sort_order: true,
              },
            },
          },
        },
      },
    });
  }

  /** 상품 활성 리뷰 수(후기 탭 카운트). */
  async countProductReviews(productId: bigint): Promise<number> {
    return this.prisma.review.count({
      where: { product_id: productId, deleted_at: null },
    });
  }

  /** 로그인 사용자의 상품 찜 여부. */
  async isProductWishlisted(args: {
    accountId: bigint;
    productId: bigint;
  }): Promise<boolean> {
    const found = await this.prisma.wishlistItem.findFirst({
      where: {
        account_id: args.accountId,
        product_id: args.productId,
        deleted_at: null,
      },
      select: { id: true },
    });
    return Boolean(found);
  }

  /**
   * 인기 케이크 랭킹 후보. 활성 상품(+활성 매장)만.
   * 카테고리/지역(2차 시군구 다중) 필터. 대표 이미지 1장 + 매장 표기 정보 포함.
   */
  async findActiveCakesForRanking(args: {
    categoryId?: bigint;
    regionIds?: bigint[];
  }): Promise<CakeCandidateRow[]> {
    return this.prisma.product.findMany({
      where: {
        is_active: true,
        deleted_at: null,
        store: {
          is_active: true,
          deleted_at: null,
          ...(args.regionIds && args.regionIds.length > 0
            ? { region_id: { in: args.regionIds } }
            : {}),
        },
        // 0n도 유효한 인자(parseId("0")=0n) → undefined로만 분기한다.
        ...(args.categoryId !== undefined
          ? {
              product_categories: {
                some: {
                  category_id: args.categoryId,
                  deleted_at: null,
                  // 홈 칩은 EVENT 카테고리만 — STYLE/OTHER id가 오면 빈 결과로 처리
                  category: {
                    is_active: true,
                    deleted_at: null,
                    category_type: 'EVENT',
                  },
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        regular_price: true,
        sale_price: true,
        images: {
          where: { deleted_at: null },
          orderBy: { sort_order: 'asc' },
          take: 1,
          select: { image_url: true },
        },
        store: {
          select: {
            store_name: true,
            address_city: true,
            address_neighborhood: true,
            region: { select: { name: true } },
          },
        },
      },
    });
  }

  /** 상품별 활성 찜 수. */
  async aggregateProductWishlistCounts(
    productIds: bigint[],
  ): Promise<Map<bigint, number>> {
    if (productIds.length === 0) return new Map();
    const rows = await this.prisma.wishlistItem.groupBy({
      by: ['product_id'],
      where: { product_id: { in: productIds }, deleted_at: null },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.product_id, r._count._all]));
  }

  /** 상품별 평균 평점·리뷰 수. */
  async aggregateProductReviewStats(
    productIds: bigint[],
  ): Promise<Map<bigint, ProductReviewStat>> {
    if (productIds.length === 0) return new Map();
    const rows = await this.prisma.review.groupBy({
      by: ['product_id'],
      where: { product_id: { in: productIds }, deleted_at: null },
      _avg: { rating: true },
      _count: { _all: true },
    });
    return new Map(
      rows.map((r) => [
        r.product_id,
        {
          average: r._avg.rating !== null ? Number(r._avg.rating) : 0,
          count: r._count._all,
        },
      ]),
    );
  }

  /** 상품별 최근 N일 유효 주문(아이템) 수. */
  async aggregateProductRecentOrderCounts(
    productIds: bigint[],
    since: Date,
  ): Promise<Map<bigint, number>> {
    if (productIds.length === 0) return new Map();
    const rows = await this.prisma.orderItem.groupBy({
      by: ['product_id'],
      where: {
        product_id: { in: productIds },
        deleted_at: null,
        order: {
          status: { in: [...RANKING_VALID_ORDER_STATUSES] },
          created_at: { gte: since },
          // soft-delete extension은 nested relation filter에 deleted_at을 주입하지
          // 않으므로(=root read만 보정), 삭제된 주문이 랭킹을 부풀리지 않도록 명시한다.
          deleted_at: null,
        },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.product_id, r._count._all]));
  }

  /**
   * 전체 활성 리뷰 평균 평점(베이지안 prior). 리뷰가 없으면 null.
   * store feature의 globalReviewAverage와 동일 정의(전 도메인 공용 prior).
   */
  async globalReviewAverage(): Promise<number | null> {
    const agg = await this.prisma.review.aggregate({
      where: { deleted_at: null },
      _avg: { rating: true },
    });
    return agg._avg.rating !== null ? Number(agg._avg.rating) : null;
  }

  /**
   * 홈 배너 1건. categoryId 지정 시 placement=CATEGORY + 해당 카테고리 링크,
   * 미지정('전체' 칩) 시 placement=HOME_MAIN. 활성 + 노출 기간(now) 유효만.
   * 링크 대상(상품/매장/카테고리)이 비활성/삭제된 배너는 건너뛴다.
   */
  async findHomeBanner(args: {
    categoryId?: bigint;
    now: Date;
  }): Promise<HomeBannerRow | null> {
    return this.prisma.banner.findFirst({
      where: {
        is_active: true,
        deleted_at: null,
        ...(args.categoryId !== undefined
          ? {
              placement: 'CATEGORY',
              link_category_id: args.categoryId,
              // 랭킹과 동일하게 홈 칩은 EVENT 카테고리만 — 비EVENT id면 배너도 없음
              link_category: {
                is_active: true,
                deleted_at: null,
                category_type: 'EVENT',
              },
            }
          : { placement: 'HOME_MAIN' }),
        OR: [{ starts_at: null }, { starts_at: { lte: args.now } }],
        AND: [
          { OR: [{ ends_at: null }, { ends_at: { gt: args.now } }] },
          {
            // 링크 대상이 내려간(비활성/삭제) 배너를 노출하면 클릭이 죽은 화면으로
            // 떨어지므로 대상 활성까지 확인하고 다음 배너로 넘어간다
            OR: [
              { link_type: { in: ['NONE', 'URL'] } },
              {
                link_type: 'PRODUCT',
                link_product: {
                  is_active: true,
                  deleted_at: null,
                  store: { is_active: true, deleted_at: null },
                },
              },
              {
                link_type: 'STORE',
                link_store: { is_active: true, deleted_at: null },
              },
              {
                link_type: 'CATEGORY',
                link_category: { is_active: true, deleted_at: null },
              },
            ],
          },
        ],
      },
      select: {
        id: true,
        image_url: true,
        title: true,
        link_type: true,
        link_url: true,
        link_product_id: true,
        link_store_id: true,
        link_category_id: true,
      },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * 랜덤 케이크 후보 id 풀. 활성 상품(+활성 매장) 중 활성 이미지 보유분만
   * (그리드 셀이 이미지라 썸네일 없는 상품은 후보에서 제외).
   * id만 조회해 풀 규모 부담을 줄인다 — 상품 수 급증 시 샘플링 방식 개선 여지.
   */
  async listRandomCakeCandidateIds(categoryId?: bigint): Promise<bigint[]> {
    const rows = await this.prisma.product.findMany({
      where: {
        is_active: true,
        deleted_at: null,
        store: { is_active: true, deleted_at: null },
        images: { some: { deleted_at: null } },
        // 0n도 유효한 인자(parseId("0")=0n) → undefined로만 분기한다.
        ...(categoryId !== undefined
          ? {
              product_categories: {
                some: {
                  category_id: categoryId,
                  deleted_at: null,
                  category: { is_active: true, deleted_at: null },
                },
              },
            }
          : {}),
      },
      select: { id: true },
      // 셔플 전 풀 순서를 고정해 주입 난수 기준 결정적 추출을 보장한다
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => row.id);
  }

  /** 랜덤 케이크 셀 데이터(대표 이미지 1장). 반환 순서는 보장하지 않는다. */
  async findRandomCakeRows(
    productIds: bigint[],
  ): Promise<{ id: bigint; images: { image_url: string }[] }[]> {
    if (productIds.length === 0) return [];
    return this.prisma.product.findMany({
      where: { id: { in: productIds }, deleted_at: null },
      select: {
        id: true,
        images: {
          where: { deleted_at: null },
          orderBy: { sort_order: 'asc' },
          take: 1,
          select: { image_url: true },
        },
      },
    });
  }

  /**
   * 전역 카테고리 목록(홈 칩·카테고리 진입 화면). 활성만.
   * category_type asc → sort_order asc → id asc.
   */
  async listCategories(type?: CategoryType) {
    return this.prisma.category.findMany({
      where: {
        is_active: true,
        deleted_at: null,
        ...(type !== undefined ? { category_type: type } : {}),
      },
      select: {
        id: true,
        name: true,
        category_type: true,
        sort_order: true,
      },
      orderBy: [{ category_type: 'asc' }, { sort_order: 'asc' }, { id: 'asc' }],
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
        product: {
          store_id: storeId,
          is_active: true,
          deleted_at: null,
          // storeProducts와 동일하게 비활성/삭제 매장은 카테고리도 노출하지 않는다
          store: { is_active: true, deleted_at: null },
        },
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
