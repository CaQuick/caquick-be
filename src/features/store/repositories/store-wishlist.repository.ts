import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/prisma';

@Injectable()
export class StoreWishlistRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 매장 찜 추가 (멱등). 없으면 생성, soft-delete된 경우 복원. */
  async upsertStoreWishlist(args: {
    accountId: bigint;
    storeId: bigint;
    now: Date;
  }): Promise<void> {
    await this.prisma.storeWishlistItem.upsert({
      where: {
        account_id_store_id: {
          account_id: args.accountId,
          store_id: args.storeId,
        },
      },
      create: { account_id: args.accountId, store_id: args.storeId },
      update: { deleted_at: null, updated_at: args.now },
    });
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
}
