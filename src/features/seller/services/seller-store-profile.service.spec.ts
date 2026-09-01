import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import type { SellerUpdateStoreBasicInfoInput } from '@/features/seller/dto/inputs/seller-update-store-basic-info.input';
import { SellerRepository } from '@/features/seller/repositories/seller.repository';
import { SellerStoreProfileService } from '@/features/seller/services/seller-store-profile.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('SellerStoreProfileService (real DB)', () => {
  let service: SellerStoreProfileService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerStoreProfileService,
        SellerRepository,
        {
          provide: AUDIT_LOG_REPOSITORY,
          useClass: AuditLogRepository,
        },
      ],
    });
    service = module.get(SellerStoreProfileService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function setupSellerWithoutStore() {
    const account = await prisma.account.create({
      data: {
        account_type: 'SELLER',
        email: `no-store-${Date.now()}-${Math.random()}@example.com`,
        name: 'no-store-seller',
      },
    });
    await prisma.sellerProfile.create({
      data: {
        account_id: account.id,
        business_name: 'no-store',
        business_phone: '02-0000-9999',
      },
    });
    return account;
  }

  describe('requireSellerContext (공통)', () => {
    it('판매자 계정이 아니면 ForbiddenException', async () => {
      const account = await createAccount(prisma, { account_type: 'USER' });
      await expect(service.sellerMyStore(account.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('SELLER인데 store가 없으면 NotFoundException', async () => {
      const account = await createAccount(prisma, { account_type: 'SELLER' });
      await expect(service.sellerMyStore(account.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('sellerMyStore', () => {
    it('SELLER + store가 있으면 매장 DTO를 반환한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma, {
        storeName: '카퀵 베이커리',
      });

      const result = await service.sellerMyStore(account.id);

      expect(result.id).toBe(store.id.toString());
      expect(result.storeName).toBe('카퀵 베이커리');
      expect(result.sellerAccountId).toBe(account.id.toString());
    });

    it('store가 없으면 NotFoundException', async () => {
      const account = await setupSellerWithoutStore();
      await expect(service.sellerMyStore(account.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('sellerUpdateStoreBasicInfo', () => {
    it('storeName/storePhone을 수정하고 audit log를 생성한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);

      const result = await service.sellerUpdateStoreBasicInfo(account.id, {
        storeName: '새 매장명',
        storePhone: '02-9999-8888',
      });

      expect(result.storeName).toBe('새 매장명');
      expect(result.storePhone).toBe('02-9999-8888');

      const dbStore = await prisma.store.findUniqueOrThrow({
        where: { id: store.id },
      });
      expect(dbStore.store_name).toBe('새 매장명');

      const auditLogs = await prisma.auditLog.findMany({
        where: { store_id: store.id },
      });
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].action).toBe('UPDATE');
      expect(auditLogs[0].target_type).toBe('STORE');
    });

    it('store가 없으면 NotFoundException', async () => {
      const account = await setupSellerWithoutStore();
      await expect(
        service.sellerUpdateStoreBasicInfo(account.id, {
          storeName: '이름',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('모든 선택 필드(주소/좌표/지도/웹사이트/영업시간 텍스트)를 포함한 수정', async () => {
      const { account } = await setupSellerWithStore(prisma);

      const result = await service.sellerUpdateStoreBasicInfo(account.id, {
        storeName: '매장',
        storePhone: '02-0000-0000',
        addressFull: '서울 어딘가 1',
        addressCity: '서울',
        addressDistrict: '어딘가구',
        addressNeighborhood: '어딘가동',
        latitude: '37.5',
        longitude: '127.0',
        mapProvider: 'NAVER',
        websiteUrl: 'https://example.com',
        businessHoursText: '월~금 09-18',
      });

      expect(result.storeName).toBe('매장');
      expect(result.addressCity).toBe('서울');
      expect(result.addressDistrict).toBe('어딘가구');
      expect(result.addressNeighborhood).toBe('어딘가동');
      expect(result.websiteUrl).toBe('https://example.com');
      expect(result.businessHoursText).toBe('월~금 09-18');
    });

    it('profileImageUrl을 등록·수정한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);

      const result = await service.sellerUpdateStoreBasicInfo(account.id, {
        profileImageUrl: 'https://cdn.example.com/logo.png',
      });

      expect(result.profileImageUrl).toBe('https://cdn.example.com/logo.png');
      const dbStore = await prisma.store.findUniqueOrThrow({
        where: { id: store.id },
      });
      expect(dbStore.profile_image_url).toBe(
        'https://cdn.example.com/logo.png',
      );
    });

    it('profileImageUrl에 null을 전달하면 제거하고, 미전달 시 유지한다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      await prisma.store.update({
        where: { id: store.id },
        data: { profile_image_url: 'https://cdn.example.com/old-logo.png' },
      });

      // 미전달(undefined) → 유지
      const kept = await service.sellerUpdateStoreBasicInfo(account.id, {
        storeName: '이름만 수정',
      });
      expect(kept.profileImageUrl).toBe('https://cdn.example.com/old-logo.png');

      // null 전달 → 제거 (GraphQL 런타임은 명시적 null을 전달할 수 있다)
      const removed = await service.sellerUpdateStoreBasicInfo(account.id, {
        profileImageUrl: null,
      } as unknown as SellerUpdateStoreBasicInfoInput);
      expect(removed.profileImageUrl).toBeNull();
    });

    it('greetingMessage를 설정하고, 빈 문자열이면 null로 되돌린다(기본 인사말 사용)', async () => {
      const { account, store } = await setupSellerWithStore(prisma);

      const set = await service.sellerUpdateStoreBasicInfo(account.id, {
        greetingMessage: '{nickname}님 반가워요! {storeName}입니다.',
      });
      expect(set.greetingMessage).toBe(
        '{nickname}님 반가워요! {storeName}입니다.',
      );
      const dbStore = await prisma.store.findUniqueOrThrow({
        where: { id: store.id },
      });
      expect(dbStore.greeting_message).toBe(
        '{nickname}님 반가워요! {storeName}입니다.',
      );

      // 빈 문자열 → null 저장(문의 채팅은 서버 기본 문구로 동작)
      const cleared = await service.sellerUpdateStoreBasicInfo(account.id, {
        greetingMessage: '   ',
      });
      expect(cleared.greetingMessage).toBeNull();
    });
  });
});
