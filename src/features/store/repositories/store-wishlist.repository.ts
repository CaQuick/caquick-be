import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/prisma';

/** 찜한 매장 목록 조회 결과 row. myWishlistedStores 매퍼 입력. */
export interface WishlistedStoreRow {
  created_at: Date;
  store: {
    id: bigint;
    store_name: string;
    profile_image_url: string | null;
    address_city: string | null;
    address_neighborhood: string | null;
    region: { name: string } | null;
  };
}

@Injectable()
export class StoreWishlistRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 매장 찜 추가 (멱등). 없으면 생성, soft-delete된 경우 복원.
   * 복원(재찜) 시에만 created_at을 재찜 시점으로 갱신한다 — 목록 '찜 최신순' 정렬과
   * addedAt 표기가 재찜을 반영하되, 이미 active인 찜에 대한 중복 요청(더블 탭·재시도)은
   * created_at을 건드리지 않아 멱등 계약을 지킨다.
   */
  async upsertStoreWishlist(args: {
    accountId: bigint;
    storeId: bigint;
    now: Date;
  }): Promise<void> {
    const restored = await this.prisma.storeWishlistItem.updateMany({
      where: {
        account_id: args.accountId,
        store_id: args.storeId,
        deleted_at: { not: null },
      },
      data: { deleted_at: null, created_at: args.now, updated_at: args.now },
    });
    if (restored.count > 0) return;

    try {
      await this.prisma.storeWishlistItem.create({
        data: { account_id: args.accountId, store_id: args.storeId },
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

  /** 매장 찜 해제 (멱등). active 항목만 soft-delete. */
  async softDeleteStoreWishlist(args: {
    accountId: bigint;
    storeId: bigint;
    now: Date;
  }): Promise<void> {
    await this.prisma.storeWishlistItem.updateMany({
      where: {
        account_id: args.accountId,
        store_id: args.storeId,
        deleted_at: null,
      },
      data: { deleted_at: args.now },
    });
  }

  /**
   * 주어진 storeIds 중 사용자가 찜한 store_id 집합(string)을 단일 IN 쿼리로 반환.
   * 비활성/soft-delete된 매장은 제외해 목록 가시성과 일관되게 한다(N+1 회피).
   */
  async findWishlistedStoreIds(args: {
    accountId: bigint;
    storeIds: bigint[];
  }): Promise<Set<string>> {
    if (args.storeIds.length === 0) return new Set();
    const rows = await this.prisma.storeWishlistItem.findMany({
      where: {
        account_id: args.accountId,
        store_id: { in: args.storeIds },
        deleted_at: null,
        store: { is_active: true, deleted_at: null },
      },
      select: { store_id: true },
    });
    return new Set(rows.map((r) => r.store_id.toString()));
  }

  /**
   * 내가 찜한 매장 목록 (찜 최신순). 비활성/soft-delete 매장은 목록·카운트 모두 제외해
   * findWishlistedStoreIds의 가시성 조건과 일관되게 한다.
   * soft-delete extension은 nested select에 deleted_at을 주입하지 않으므로 직접 명시한다.
   */
  async findWishlistedStores(args: {
    accountId: bigint;
    offset: number;
    limit: number;
  }): Promise<{ items: WishlistedStoreRow[]; totalCount: number }> {
    const where = {
      account_id: args.accountId,
      deleted_at: null,
      store: { is_active: true, deleted_at: null },
    };

    const [items, totalCount] = await this.prisma.$transaction([
      this.prisma.storeWishlistItem.findMany({
        where,
        // 같은 밀리초 생성 시 페이지 경계 흔들림 방지를 위해 id를 보조 정렬키로 둔다.
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: args.offset,
        take: args.limit,
        select: {
          created_at: true,
          store: {
            select: {
              id: true,
              store_name: true,
              profile_image_url: true,
              address_city: true,
              address_neighborhood: true,
              region: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.storeWishlistItem.count({ where }),
    ]);

    return { items, totalCount };
  }

  /** 활성 USER 계정 여부. 매장 찜은 구매자(USER)만 가능 → 인기 랭킹 무결성 보호. */
  async isActiveUserAccount(accountId: bigint): Promise<boolean> {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, account_type: 'USER', deleted_at: null },
      select: { id: true },
    });
    return Boolean(account);
  }
}
