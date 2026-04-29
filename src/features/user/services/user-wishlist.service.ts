import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import { ProductRepository } from '@/features/product/repositories/product.repository';
import { USER_WISHLIST_ERRORS } from '@/features/user/constants/user-wishlist-error-messages';
import {
  DEFAULT_PAGINATION_LIMIT,
  MAX_PAGINATION_LIMIT,
} from '@/features/user/constants/user.constants';
import { UserRepository } from '@/features/user/repositories/user.repository';
import { UserBaseService } from '@/features/user/services/user-base.service';
import type {
  MyWishlistConnection,
  MyWishlistInput,
} from '@/features/user/types/user-wishlist-output.type';

@Injectable()
export class UserWishlistService extends UserBaseService {
  constructor(
    repo: UserRepository,
    private readonly productRepository: ProductRepository,
  ) {
    super(repo);
  }

  async addToWishlist(
    accountId: bigint,
    productIdStr: string,
  ): Promise<boolean> {
    await this.requireActiveUser(accountId);
    const productId = parseId(productIdStr);

    const exists = await this.productRepository.existsActiveProduct(productId);
    if (!exists) {
      throw new NotFoundException(USER_WISHLIST_ERRORS.PRODUCT_NOT_FOUND);
    }

    await this.repo.upsertWishlistItem({
      accountId,
      productId,
      now: new Date(),
    });
    return true;
  }

  async removeFromWishlist(
    accountId: bigint,
    productIdStr: string,
  ): Promise<boolean> {
    await this.requireActiveUser(accountId);
    const productId = parseId(productIdStr);

    await this.repo.softDeleteWishlistItem({
      accountId,
      productId,
      now: new Date(),
    });
    return true;
  }

  async myWishlist(
    accountId: bigint,
    input?: MyWishlistInput,
  ): Promise<MyWishlistConnection> {
    await this.requireActiveUser(accountId);

    const offset = input?.offset ?? 0;
    const limit = input?.limit ?? DEFAULT_PAGINATION_LIMIT;

    if (offset < 0) {
      throw new BadRequestException(USER_WISHLIST_ERRORS.INVALID_OFFSET);
    }
    if (limit < 1 || limit > MAX_PAGINATION_LIMIT) {
      throw new BadRequestException(USER_WISHLIST_ERRORS.INVALID_LIMIT);
    }

    const { items, totalCount } = await this.repo.findWishlistItems({
      accountId,
      offset,
      limit,
    });

    return {
      items: items.map((row) => ({
        productId: row.product_id.toString(),
        productName: row.product.name,
        representativeImageUrl: row.product.images[0]?.image_url ?? null,
        salePrice: row.product.sale_price,
        regularPrice: row.product.regular_price,
        storeName: row.product.store.store_name,
        addedAt: row.created_at,
      })),
      totalCount,
      hasMore: offset + limit < totalCount,
    };
  }
}
