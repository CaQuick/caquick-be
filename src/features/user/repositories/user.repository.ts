import { Injectable } from '@nestjs/common';
import {
  AccountType,
  CustomDraftStatus,
  NotificationEvent,
  NotificationType,
} from '@prisma/client';

import { PrismaService } from '@/prisma';

export interface UserAccountWithProfile {
  id: bigint;
  account_type: AccountType;
  email: string | null;
  name: string | null;
  deleted_at: Date | null;
  user_profile: {
    nickname: string;
    birth_date: Date | null;
    phone_number: string | null;
    profile_image_url: string | null;
    onboarding_completed_at: Date | null;
    deleted_at: Date | null;
  } | null;
}

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  private activeRelationWhere<T extends Record<string, unknown>>(
    where: T,
  ): T & { deleted_at: null } {
    return { ...where, deleted_at: null };
  }

  /**
   * 화면에 노출 가능한 wishlist row 조건.
   * - wishlist 자체가 active (deleted_at: null)
   * - 연결된 product 가 active + soft-delete 아님
   * - 연결된 store 가 active + soft-delete 아님
   *
   * count 와 list 가 같은 가시성 기준을 공유하도록 하여
   * 마이페이지 카운트 카드와 실제 목록 길이 불일치를 방지한다.
   */
  private visibleWishlistWhere(accountId: bigint) {
    return {
      account_id: accountId,
      deleted_at: null,
      product: {
        deleted_at: null,
        is_active: true,
        store: { deleted_at: null, is_active: true },
      },
    } as const;
  }

  async findAccountWithProfile(
    accountId: bigint,
    options?: { withDeleted?: boolean },
  ): Promise<UserAccountWithProfile | null> {
    const where = {
      id: accountId,
      ...(options?.withDeleted ? { deleted_at: undefined } : {}),
    };
    const args = {
      where,
      include: {
        user_profile: true,
      },
    };
    return this.prisma.account.findFirst(args);
  }

  async isNicknameTaken(
    nickname: string,
    excludeAccountId?: bigint,
  ): Promise<boolean> {
    const found = await this.prisma.userProfile.findFirst({
      where: {
        nickname,
        ...(excludeAccountId ? { account_id: { not: excludeAccountId } } : {}),
      },
      select: { id: true },
    });
    return Boolean(found);
  }

  async completeOnboarding(args: {
    accountId: bigint;
    name?: string | null;
    nickname: string;
    birthDate?: Date | null;
    phoneNumber?: string | null;
    now: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (args.name) {
        await tx.account.updateMany({
          where: { id: args.accountId, name: null },
          data: { name: args.name },
        });
      }

      await tx.userProfile.update({
        where: { account_id: args.accountId },
        data: {
          nickname: args.nickname,
          birth_date: args.birthDate ?? null,
          phone_number: args.phoneNumber ?? null,
          onboarding_completed_at: args.now,
        },
      });
    });
  }

  async updateProfile(args: {
    accountId: bigint;
    nickname?: string;
    name?: string;
    birthDate?: Date | null;
    phoneNumber?: string | null;
  }): Promise<void> {
    const hasName = args.name !== undefined;
    const hasProfileFields =
      args.nickname !== undefined ||
      args.birthDate !== undefined ||
      args.phoneNumber !== undefined;

    // name은 account 테이블, 나머지는 user_profile 테이블이라
    // 두 테이블 부분 실패 방지를 위해 transaction으로 묶는다.
    await this.prisma.$transaction(async (tx) => {
      if (hasName) {
        await tx.account.update({
          where: { id: args.accountId },
          data: { name: args.name },
        });
      }
      if (hasProfileFields) {
        await tx.userProfile.update({
          where: { account_id: args.accountId },
          data: {
            ...(args.nickname !== undefined ? { nickname: args.nickname } : {}),
            ...(args.birthDate !== undefined
              ? { birth_date: args.birthDate }
              : {}),
            ...(args.phoneNumber !== undefined
              ? { phone_number: args.phoneNumber }
              : {}),
          },
        });
      }
    });
  }

  async updateProfileImage(args: {
    accountId: bigint;
    profileImageUrl: string | null;
  }): Promise<void> {
    await this.prisma.userProfile.update({
      where: { account_id: args.accountId },
      data: { profile_image_url: args.profileImageUrl },
    });
  }

  async softDeleteAccount(args: {
    accountId: bigint;
    deletedNickname: string;
    now: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.userProfile.update({
        where: { account_id: args.accountId },
        data: {
          nickname: args.deletedNickname,
          deleted_at: args.now,
        },
      });

      await tx.account.update({
        where: { id: args.accountId },
        data: {
          deleted_at: args.now,
          email: null,
        },
      });

      await tx.authRefreshSession.updateMany({
        where: {
          account_id: args.accountId,
          revoked_at: null,
          deleted_at: null,
        },
        data: {
          revoked_at: args.now,
          deleted_at: args.now,
        },
      });
    });
  }

  async getViewerCounts(accountId: bigint): Promise<{
    unreadNotificationCount: number;
    cartItemCount: number;
    wishlistCount: number;
  }> {
    const [unreadNotificationCount, cartItemCount, wishlistCount] =
      await this.prisma.$transaction([
        this.prisma.notification.count({
          where: {
            account_id: accountId,
            read_at: null,
          },
        }),
        this.prisma.cartItem.count({
          where: {
            cart: this.activeRelationWhere({ account_id: accountId }),
          },
        }),
        this.prisma.wishlistItem.count({
          where: this.visibleWishlistWhere(accountId),
        }),
      ]);

    return { unreadNotificationCount, cartItemCount, wishlistCount };
  }

  async listNotifications(args: {
    accountId: bigint;
    unreadOnly: boolean;
    offset: number;
    limit: number;
  }): Promise<{
    items: {
      id: bigint;
      type: NotificationType;
      title: string;
      body: string;
      read_at: Date | null;
      created_at: Date;
    }[];
    totalCount: number;
  }> {
    const where = {
      account_id: args.accountId,
      ...(args.unreadOnly ? { read_at: null } : {}),
    };

    const [items, totalCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: args.offset,
        take: args.limit,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          read_at: true,
          created_at: true,
        },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items, totalCount };
  }

  async markNotificationRead(args: {
    accountId: bigint;
    notificationId: bigint;
    now: Date;
  }): Promise<boolean> {
    const found = await this.prisma.notification.findFirst({
      where: {
        id: args.notificationId,
        account_id: args.accountId,
      },
    });

    if (!found) return false;

    if (!found.read_at) {
      await this.prisma.notification.update({
        where: { id: found.id },
        data: { read_at: args.now },
      });
    }

    return true;
  }

  async markAllNotificationsRead(args: {
    accountId: bigint;
    now: Date;
  }): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: {
        account_id: args.accountId,
        deleted_at: null,
        read_at: null,
      },
      data: { read_at: args.now },
    });

    return result.count;
  }

  async listSearchHistories(args: {
    accountId: bigint;
    offset: number;
    limit: number;
  }): Promise<{
    items: {
      id: bigint;
      keyword: string;
      last_used_at: Date;
    }[];
    totalCount: number;
  }> {
    const where = {
      account_id: args.accountId,
    };

    const [items, totalCount] = await this.prisma.$transaction([
      this.prisma.searchHistory.findMany({
        where,
        orderBy: { last_used_at: 'desc' },
        skip: args.offset,
        take: args.limit,
        select: {
          id: true,
          keyword: true,
          last_used_at: true,
        },
      }),
      this.prisma.searchHistory.count({ where }),
    ]);

    return { items, totalCount };
  }

  async deleteSearchHistory(args: {
    accountId: bigint;
    id: bigint;
    now: Date;
  }): Promise<boolean> {
    const result = await this.prisma.searchHistory.updateMany({
      where: {
        id: args.id,
        account_id: args.accountId,
        deleted_at: null,
      },
      data: { deleted_at: args.now },
    });
    return result.count > 0;
  }

  async clearSearchHistories(args: {
    accountId: bigint;
    now: Date;
  }): Promise<number> {
    const result = await this.prisma.searchHistory.updateMany({
      where: {
        account_id: args.accountId,
        deleted_at: null,
      },
      data: { deleted_at: args.now },
    });
    return result.count;
  }

  async countCustomDrafts(accountId: bigint): Promise<number> {
    return this.prisma.customDraft.count({
      where: {
        account_id: accountId,
        status: {
          in: [
            CustomDraftStatus.IN_PROGRESS,
            CustomDraftStatus.READY_FOR_ORDER,
          ],
        },
      },
    });
  }

  async countWishlistItems(accountId: bigint): Promise<number> {
    return this.prisma.wishlistItem.count({
      where: this.visibleWishlistWhere(accountId),
    });
  }

  /**
   * 찜 추가 (멱등). 이미 있으면 그대로, soft-delete된 경우 deleted_at=null로 복원.
   */
  async upsertWishlistItem(args: {
    accountId: bigint;
    productId: bigint;
    now: Date;
  }): Promise<void> {
    await this.prisma.wishlistItem.upsert({
      where: {
        account_id_product_id: {
          account_id: args.accountId,
          product_id: args.productId,
        },
      },
      create: {
        account_id: args.accountId,
        product_id: args.productId,
      },
      update: { deleted_at: null, updated_at: args.now },
    });
  }

  /**
   * 찜 해제 (멱등). active 항목만 soft-delete.
   */
  async softDeleteWishlistItem(args: {
    accountId: bigint;
    productId: bigint;
    now: Date;
  }): Promise<void> {
    await this.prisma.wishlistItem.updateMany({
      where: {
        account_id: args.accountId,
        product_id: args.productId,
        deleted_at: null,
      },
      data: { deleted_at: args.now },
    });
  }

  /**
   * 주어진 productIds 중 사용자가 찜한 것들의 product_id 집합을 단일 IN 쿼리로 반환.
   * 매핑(N+1 회피)용.
   */
  async findWishlistedProductIds(args: {
    accountId: bigint;
    productIds: bigint[];
  }): Promise<Set<string>> {
    if (args.productIds.length === 0) return new Set();
    const rows = await this.prisma.wishlistItem.findMany({
      where: {
        account_id: args.accountId,
        deleted_at: null,
        product_id: { in: args.productIds },
      },
      select: { product_id: true },
    });
    return new Set(rows.map((r) => r.product_id.toString()));
  }

  /**
   * 내 찜 목록 조회. 비활성/soft-delete된 product/store는 제외.
   */
  async findWishlistItems(args: {
    accountId: bigint;
    offset: number;
    limit: number;
  }): Promise<{
    items: {
      product_id: bigint;
      created_at: Date;
      product: {
        name: string;
        regular_price: number;
        sale_price: number | null;
        images: { image_url: string }[];
        store: { store_name: string };
      };
    }[];
    totalCount: number;
  }> {
    const where = this.visibleWishlistWhere(args.accountId);

    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.wishlistItem.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: args.offset,
        take: args.limit,
        select: {
          product_id: true,
          created_at: true,
          product: {
            select: {
              name: true,
              regular_price: true,
              sale_price: true,
              store: { select: { store_name: true } },
              images: {
                where: { deleted_at: null },
                orderBy: { sort_order: 'asc' },
                take: 1,
                select: { image_url: true },
              },
            },
          },
        },
      }),
      this.prisma.wishlistItem.count({ where }),
    ]);

    return { items: rows, totalCount };
  }

  async countMyReviews(accountId: bigint): Promise<number> {
    return this.prisma.review.count({
      where: { account_id: accountId },
    });
  }

  async likeReview(args: {
    accountId: bigint;
    reviewId: bigint;
  }): Promise<'liked' | 'already-liked' | 'not-found' | 'self-like'> {
    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.findFirst({
        where: {
          id: args.reviewId,
        },
        select: {
          id: true,
          account_id: true,
          store_id: true,
          product_id: true,
        },
      });

      if (!review) return 'not-found';
      if (review.account_id === args.accountId) return 'self-like';

      const existing = await tx.reviewLike.findFirst({
        where: {
          review_id: review.id,
          account_id: args.accountId,
        },
        select: { id: true },
      });

      if (existing) return 'already-liked';

      await tx.reviewLike.create({
        data: {
          review_id: review.id,
          account_id: args.accountId,
        },
      });

      await tx.notification.create({
        data: {
          account_id: review.account_id,
          type: NotificationType.REVIEW_LIKE,
          event: NotificationEvent.REVIEW_LIKED,
          title: '리뷰에 좋아요가 추가되었습니다',
          body: '회원님의 리뷰를 다른 사용자가 좋아합니다.',
          review_id: review.id,
          store_id: review.store_id,
          product_id: review.product_id,
        },
      });

      return 'liked';
    });
  }
}
