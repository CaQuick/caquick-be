import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { StoreWishlistRepository } from '@/features/store/repositories/store-wishlist.repository';
import { StoreRepository } from '@/features/store/repositories/store.repository';
import { StoreWishlistService } from '@/features/store/services/store-wishlist.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createStore,
  createStoreWishlist,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('StoreWishlistService (real DB)', () => {
  let service: StoreWishlistService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        StoreWishlistService,
        StoreWishlistRepository,
        StoreRepository,
      ],
    });
    service = module.get(StoreWishlistService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function activeWishlistCount(
    accountId: bigint,
    storeId: bigint,
  ): Promise<number> {
    return prisma.storeWishlistItem.count({
      where: { account_id: accountId, store_id: storeId, deleted_at: null },
    });
  }

  describe('addStoreToWishlist', () => {
    it('매장을 찜한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const store = await createStore(prisma);

      const ok = await service.addStoreToWishlist(
        account.id,
        store.id.toString(),
      );

      expect(ok).toBe(true);
      expect(await activeWishlistCount(account.id, store.id)).toBe(1);
    });

    it('중복 추가는 멱등하다(1건 유지)', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const store = await createStore(prisma);

      await service.addStoreToWishlist(account.id, store.id.toString());
      await service.addStoreToWishlist(account.id, store.id.toString());

      expect(await activeWishlistCount(account.id, store.id)).toBe(1);
    });

    it('soft-delete된 찜은 복원한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const store = await createStore(prisma);
      await createStoreWishlist(prisma, {
        account_id: account.id,
        store_id: store.id,
        deleted_at: new Date(),
      });

      await service.addStoreToWishlist(account.id, store.id.toString());

      expect(await activeWishlistCount(account.id, store.id)).toBe(1);
    });

    it('존재하지 않는 매장이면 NotFoundException', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await expect(
        service.addStoreToWishlist(account.id, '999999'),
      ).rejects.toThrow(NotFoundException);
    });

    it('비활성 매장이면 NotFoundException', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const inactive = await createStore(prisma, { is_active: false });
      await expect(
        service.addStoreToWishlist(account.id, inactive.id.toString()),
      ).rejects.toThrow(NotFoundException);
    });

    it('유효하지 않은 storeId면 BadRequestException', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await expect(
        service.addStoreToWishlist(account.id, 'not-a-number'),
      ).rejects.toThrow(BadRequestException);
    });

    it('USER가 아닌 계정(SELLER)은 찜할 수 없다(Forbidden)', async () => {
      const seller = await createAccount(prisma, { account_type: 'SELLER' });
      const store = await createStore(prisma);
      await expect(
        service.addStoreToWishlist(seller.id, store.id.toString()),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('removeStoreFromWishlist', () => {
    it('찜을 해제한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const store = await createStore(prisma);
      await createStoreWishlist(prisma, {
        account_id: account.id,
        store_id: store.id,
      });

      const ok = await service.removeStoreFromWishlist(
        account.id,
        store.id.toString(),
      );

      expect(ok).toBe(true);
      expect(await activeWishlistCount(account.id, store.id)).toBe(0);
    });

    it('찜이 없어도 멱등하게 true를 반환한다', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      const store = await createStore(prisma);

      const ok = await service.removeStoreFromWishlist(
        account.id,
        store.id.toString(),
      );

      expect(ok).toBe(true);
    });
  });
});
