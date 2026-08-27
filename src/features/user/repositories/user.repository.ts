import { Injectable } from '@nestjs/common';
import {
  AccountType,
  CustomDraftStatus,
  IdentityProvider,
  NotificationType,
  Prisma,
} from '@prisma/client';

import { buildWithdrawnProviderSubject } from '@/common/utils/withdrawn-identity';
import { buildReviewLikedNotification } from '@/features/notification';
import { activeWhere, PrismaService, visibleWhere } from '@/prisma';

export interface UserAccountIdentity {
  provider: IdentityProvider;
  last_login_at: Date | null;
}

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
  account_identities: UserAccountIdentity[];
}

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 화면에 노출 가능한 wishlist row 조건.
   * - wishlist 자체가 active (deleted_at: null)
   * - 연결된 product 가 active + soft-delete 아님
   * - 연결된 store 가 active + soft-delete 아님
   *
   * count 와 list 가 같은 가시성 기준을 공유하도록 하여
   * 마이페이지 카운트 카드와 실제 목록 길이 불일치를 방지한다.
   */
  private visibleWishlistWhere(accountId: bigint, storeId?: bigint) {
    return {
      account_id: accountId,
      ...activeWhere,
      product: {
        ...visibleWhere,
        // 매장별 보기 → 매장 선택 화면의 매장 필터
        ...(storeId !== undefined ? { store_id: storeId } : {}),
        store: visibleWhere,
      },
    } as const;
  }

  async findAccountWithProfile(
    accountId: bigint,
    options?: { withDeleted?: boolean },
  ): Promise<UserAccountWithProfile | null> {
    return this.prisma.account.findFirst({
      where: {
        id: accountId,
        ...(options?.withDeleted ? { deleted_at: undefined } : {}),
      },
      include: {
        user_profile: true,
        // soft-deleted identity는 노출 대상 아님. 최근 로그인 순으로 정렬해
        // FE가 "최근 로그인 provider" 표시할 때 별도 정렬 없이 사용 가능.
        account_identities: {
          where: activeWhere,
          orderBy: [{ last_login_at: 'desc' }, { id: 'asc' }],
          select: { provider: true, last_login_at: true },
        },
      },
    });
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

      await this.retireAccountIdentities(tx, args.accountId, args.now);

      await tx.authRefreshSession.updateMany({
        where: {
          account_id: args.accountId,
          revoked_at: null,
          ...activeWhere,
        },
        data: {
          revoked_at: args.now,
          deleted_at: args.now,
        },
      });
    });
  }

  /**
   * 탈퇴 계정에 연결된 소셜 연동을 은퇴 처리한다.
   *
   * soft-delete 만 하면 `(provider, provider_subject)` UNIQUE 가 그대로 남아
   * 같은 소셜 계정으로 재가입할 때 identity 를 새로 만들 수 없다(MySQL unique index 는
   * deleted_at 을 보지 않는다). subject 를 익명화해 자리를 비워 준다.
   *
   * updateMany 로는 컬럼 값을 기존 값 기반으로 바꿀 수 없어 row 단위로 처리한다.
   * 한 계정의 연동 수는 provider 수준(한 자릿수)이라 비용 문제는 없다.
   */
  private async retireAccountIdentities(
    tx: Prisma.TransactionClient,
    accountId: bigint,
    now: Date,
  ): Promise<void> {
    const identities = await tx.accountIdentity.findMany({
      where: { account_id: accountId },
      select: { id: true, provider_subject: true },
    });

    for (const identity of identities) {
      await tx.accountIdentity.update({
        where: { id: identity.id },
        data: {
          provider_subject: buildWithdrawnProviderSubject(
            accountId,
            identity.provider_subject,
          ),
          deleted_at: now,
        },
      });
    }
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
            cart: { account_id: accountId, ...activeWhere },
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
        ...activeWhere,
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
        ...activeWhere,
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
        ...activeWhere,
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
   * 찜 추가 (멱등). 없으면 생성, soft-delete된 경우 복원.
   * 복원(재찜) 시에만 created_at을 재찜 시점으로 갱신한다 — 목록 '찜 최신순' 정렬과
   * addedAt 표기가 재찜을 반영하되, 이미 active인 찜에 대한 중복 요청(더블 탭·재시도)은
   * created_at을 건드리지 않아 멱등 계약을 지킨다(매장 찜 upsertStoreWishlist와 동일 정책).
   */
  async upsertWishlistItem(args: {
    accountId: bigint;
    productId: bigint;
    now: Date;
  }): Promise<void> {
    const restored = await this.prisma.wishlistItem.updateMany({
      where: {
        account_id: args.accountId,
        product_id: args.productId,
        deleted_at: { not: null },
      },
      data: { deleted_at: null, created_at: args.now, updated_at: args.now },
    });
    if (restored.count > 0) return;

    try {
      await this.prisma.wishlistItem.create({
        data: {
          account_id: args.accountId,
          product_id: args.productId,
        },
      });
    } catch (error) {
      // active 찜이 이미 존재(unique 충돌) — 멱등이므로 무시
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return;
      }
      throw error;
    }
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
        ...activeWhere,
      },
      data: { deleted_at: args.now },
    });
  }

  /**
   * 주어진 productIds 중 사용자가 찜한 것들의 product_id 집합을 단일 IN 쿼리로 반환.
   * 매핑(N+1 회피)용. 가시성 조건(visibleWishlistWhere)을 myWishlist/wishlistCount와
   * 공유하여, recent-view 등에 노출되는 isWishlisted 플래그가 실제 wishlist 표면
   * (목록/카운트)과 일관되도록 한다.
   */
  async findWishlistedProductIds(args: {
    accountId: bigint;
    productIds: bigint[];
  }): Promise<Set<string>> {
    if (args.productIds.length === 0) return new Set();
    const rows = await this.prisma.wishlistItem.findMany({
      where: {
        ...this.visibleWishlistWhere(args.accountId),
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
    storeId?: bigint;
  }): Promise<{
    items: {
      product_id: bigint;
      created_at: Date;
      product: {
        store_id: bigint;
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
      };
    }[];
    totalCount: number;
  }> {
    const where = this.visibleWishlistWhere(args.accountId, args.storeId);

    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.wishlistItem.findMany({
        where,
        // 같은 밀리초 생성 시 페이지 경계 흔들림 방지를 위해 product_id를 보조 정렬키로 둔다.
        orderBy: [{ created_at: 'desc' }, { product_id: 'desc' }],
        skip: args.offset,
        take: args.limit,
        select: {
          product_id: true,
          created_at: true,
          product: {
            select: {
              store_id: true,
              name: true,
              regular_price: true,
              sale_price: true,
              store: {
                select: {
                  store_name: true,
                  address_city: true,
                  address_neighborhood: true,
                  region: { select: { name: true } },
                },
              },
              images: {
                where: activeWhere,
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

  /**
   * 매장별 그룹핑용 가시 찜 목록 전체 조회.
   * WishlistItem에는 store_id가 없어(product 경유) Prisma groupBy로 매장 단위 집계가
   * 불가능하다 → 최소 필드만 가져와 service에서 그룹핑한다(찜은 사용자당 소규모 전제).
   * 가시성 조건은 findWishlistItems/wishlistCount와 동일(visibleWishlistWhere)해야
   * 상품 찜 목록 totalCount와 그룹 카운트 합이 일치한다.
   */
  async findVisibleWishlistItemsForGrouping(accountId: bigint): Promise<
    {
      created_at: Date;
      product: {
        store: {
          id: bigint;
          store_name: string;
          profile_image_url: string | null;
        };
      };
    }[]
  > {
    return this.prisma.wishlistItem.findMany({
      where: this.visibleWishlistWhere(accountId),
      select: {
        created_at: true,
        product: {
          select: {
            store: {
              select: {
                id: true,
                store_name: true,
                profile_image_url: true,
              },
            },
          },
        },
      },
    });
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
          // soft-delete 필터 우회: 해제(soft-delete)된 좋아요도 찾아 복원한다.
          // uk_review_like 유니크 제약 때문에 새로 create하면 충돌한다.
          deleted_at: undefined,
        },
        select: { id: true, deleted_at: true },
      });

      if (existing && existing.deleted_at === null) return 'already-liked';

      if (existing) {
        // 해제했던 좋아요 복원. 좋아요↔해제 반복으로 인한 알림 스팸을 막기 위해
        // 알림은 최초 좋아요(신규 생성)에만 발송한다.
        await tx.reviewLike.update({
          where: { id: existing.id },
          data: { deleted_at: null },
        });
        return 'liked';
      }

      await tx.reviewLike.create({
        data: {
          review_id: review.id,
          account_id: args.accountId,
        },
      });

      // 알림 내용은 notification feature가 단일 소스 — 여기는 저장 위임만 한다
      await tx.notification.create({
        data: {
          account_id: review.account_id,
          review_id: review.id,
          store_id: review.store_id,
          product_id: review.product_id,
          ...buildReviewLikedNotification(),
        },
      });

      return 'liked';
    });
  }

  /** 리뷰 좋아요 해제(soft). 좋아요가 없어도 성공 처리(멱등). */
  async unlikeReview(args: {
    accountId: bigint;
    reviewId: bigint;
  }): Promise<'unliked' | 'not-found'> {
    const review = await this.prisma.review.findFirst({
      where: { id: args.reviewId },
      select: { id: true },
    });
    if (!review) return 'not-found';

    await this.prisma.reviewLike.updateMany({
      where: {
        review_id: args.reviewId,
        account_id: args.accountId,
        ...activeWhere,
      },
      data: { deleted_at: new Date() },
    });
    return 'unliked';
  }

  /**
   * 리뷰 댓글 작성. 리뷰가 없으면(soft-delete 포함) 생성하지 않는다.
   * 공개 조회(reviewComments)와 동일하게 상품·매장 활성 가드를 적용해
   * 작성 직후 조회 불가능한 댓글이 생기지 않게 한다.
   *
   * 리뷰 row를 FOR SHARE로 잠가 삭제 트랜잭션(review UPDATE → 댓글 정리)과
   * 직렬화한다 — 체크와 insert 사이에 리뷰가 삭제되어 정리 대상에서 빠지는
   * 댓글(리뷰 재작성 시 되살아나는 좀비 댓글)을 막는다.
   */
  async createReviewComment(args: {
    accountId: bigint;
    reviewId: bigint;
    content: string;
  }): Promise<
    | { id: bigint; review_id: bigint; content: string; created_at: Date }
    | 'review-not-found'
  > {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
        SELECT r.id
        FROM review r
        JOIN product p
          ON p.id = r.product_id AND p.is_active = 1 AND p.deleted_at IS NULL
        JOIN store s
          ON s.id = p.store_id AND s.is_active = 1 AND s.deleted_at IS NULL
        WHERE r.id = ${args.reviewId} AND r.deleted_at IS NULL
        FOR SHARE OF r
      `);
      if (locked.length === 0) return 'review-not-found';

      return tx.reviewComment.create({
        data: {
          review_id: args.reviewId,
          account_id: args.accountId,
          content: args.content,
        },
        select: { id: true, review_id: true, content: true, created_at: true },
      });
    });
  }

  /** 내 리뷰 댓글 soft-delete. 소유자 검증 포함. */
  async softDeleteMyReviewComment(args: {
    accountId: bigint;
    commentId: bigint;
  }): Promise<'deleted' | 'not-found' | 'forbidden'> {
    const comment = await this.prisma.reviewComment.findFirst({
      // extension이 주입하지만 재삭제 방지 계약을 코드에서 바로 읽도록 명시한다
      where: { id: args.commentId, ...activeWhere },
      select: { id: true, account_id: true },
    });
    if (!comment) return 'not-found';
    if (comment.account_id !== args.accountId) return 'forbidden';

    await this.prisma.reviewComment.update({
      where: { id: args.commentId },
      data: { deleted_at: new Date() },
    });
    return 'deleted';
  }
}
