import { BadRequestException, NotFoundException } from '@nestjs/common';
import argon2 from 'argon2';

import type { AdminCreateSellerInput } from '@/features/admin/dto/inputs/admin-create-seller.input';
import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminSellerService } from '@/features/admin/services/admin-seller.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createAccountCredential,
  createRefreshSession,
  createRegion,
  createSellerProfile,
  createStore,
  setupSellerWithStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AdminSellerService (real DB)', () => {
  let service: AdminSellerService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminSellerService,
        AdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    service = module.get(AdminSellerService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function admin(): Promise<bigint> {
    return (await createAccount(prisma, { account_type: 'ADMIN' })).id;
  }

  /** 자격증명·프로필·매장을 갖춘 판매자 한 세트. */
  async function makeSeller(
    overrides: {
      username?: string;
      storeName?: string;
      email?: string;
      name?: string;
    } = {},
  ) {
    const { account, store } = await setupSellerWithStore(prisma, {
      storeName: overrides.storeName,
    });
    if (overrides.email !== undefined || overrides.name !== undefined) {
      await prisma.account.update({
        where: { id: account.id },
        data: { email: overrides.email, name: overrides.name },
      });
    }
    const credential = await createAccountCredential(prisma, {
      account_id: account.id,
      username: overrides.username,
    });
    return { account, store, credential };
  }

  const validInput: AdminCreateSellerInput = {
    username: 'cake.shop_1',
    password: 'Strong!Pass1',
    email: 'shop@example.com',
    name: '홍길동',
    businessName: '케이크샵 A',
    businessPhone: '02-1111-2222',
    websiteUrl: 'https://cake.example',
    store: {
      storeName: '케이크샵 A 강남점',
      storePhone: '02-3333-4444',
      addressFull: '서울특별시 강남구 테헤란로 1',
      addressCity: '서울특별시',
      addressDistrict: '강남구',
      latitude: '37.5012',
      longitude: '127.0396',
      mapProvider: 'NAVER',
    },
  };

  describe('adminSellers', () => {
    it('SELLER 계정만 최신 생성순으로 반환하고 자격증명·프로필·매장 요약을 합친다', async () => {
      const first = await makeSeller({ username: 'first.seller' });
      const second = await makeSeller({ username: 'second.seller' });
      await createAccount(prisma, { account_type: 'USER' });
      await createAccount(prisma, { account_type: 'ADMIN' });

      const result = await service.adminSellers(await admin());

      expect(result.totalCount).toBe(2);
      expect(result.items.map((s) => s.accountId)).toEqual([
        second.account.id.toString(),
        first.account.id.toString(),
      ]);
      const item = result.items[1];
      expect(item.username).toBe('first.seller');
      expect(item.profile?.businessName).toBeDefined();
      expect(item.store?.id).toBe(first.store.id.toString());
    });

    // keyword가 닿는 축 전수: username·이메일·이름·매장명
    it.each([
      ['username', { username: 'needle.user' }, 'needle.us'],
      ['이메일', { email: 'needle@example.com' }, 'needle@'],
      ['이름', { name: '바늘상회 대표' }, '바늘상회'],
      ['매장명', { storeName: '바늘 케이크' }, '바늘 케'],
    ])('keyword는 %s 부분일치로 찾는다', async (_label, overrides, keyword) => {
      const target = await makeSeller(overrides);
      await makeSeller();

      const result = await service.adminSellers(await admin(), { keyword });

      expect(result.totalCount).toBe(1);
      expect(result.items[0].accountId).toBe(target.account.id.toString());
    });

    it('status 필터가 목록과 totalCount에 적용된다', async () => {
      const suspended = await makeSeller();
      await prisma.account.update({
        where: { id: suspended.account.id },
        data: { status: 'SUSPENDED' },
      });
      await makeSeller();

      const result = await service.adminSellers(await admin(), {
        status: 'SUSPENDED',
      });

      expect(result.totalCount).toBe(1);
      expect(result.items[0].status).toBe('SUSPENDED');
    });

    it('limit+1 조회로 hasMore·nextCursor를 판정한다', async () => {
      const ids = [
        (await makeSeller()).account.id,
        (await makeSeller()).account.id,
        (await makeSeller()).account.id,
      ];

      const page1 = await service.adminSellers(await admin(), { limit: 2 });
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBe(ids[1].toString());

      const page2 = await service.adminSellers(await admin(), {
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items.map((s) => s.accountId)).toEqual([ids[0].toString()]);
    });

    it('삭제된 자격증명은 없는 것으로 보고 keyword 검색에서도 빠진다', async () => {
      const { account, credential } = await makeSeller({
        username: 'gone.user',
      });
      await prisma.accountCredential.update({
        where: { id: credential.id },
        data: { deleted_at: new Date() },
      });

      const all = await service.adminSellers(await admin());
      expect(all.items[0].accountId).toBe(account.id.toString());
      expect(all.items[0].username).toBeNull();
      expect(all.items[0].mustChangePassword).toBe(false);

      const searched = await service.adminSellers(await admin(), {
        keyword: 'gone.us',
      });
      expect(searched.totalCount).toBe(0);
    });

    it('삭제된 매장·프로필은 null로 내리고, 자격증명 없는 판매자는 username null', async () => {
      const account = await createAccount(prisma, { account_type: 'SELLER' });
      await createSellerProfile(prisma, { account_id: account.id });
      await createStore(prisma, {
        seller_account_id: account.id,
        deleted_at: new Date(),
      });

      const result = await service.adminSellers(await admin());

      expect(result.items[0].store).toBeNull();
      expect(result.items[0].profile).not.toBeNull();
      expect(result.items[0].username).toBeNull();
    });
  });

  describe('adminSeller', () => {
    it('판매자 1건을 반환한다', async () => {
      const { account, credential } = await makeSeller();
      const result = await service.adminSeller(await admin(), account.id);
      expect(result.username).toBe(credential.username);
    });

    it.each([
      [
        'USER 계정',
        async () => (await createAccount(prisma, { account_type: 'USER' })).id,
      ],
      [
        'ADMIN 계정',
        async () => (await createAccount(prisma, { account_type: 'ADMIN' })).id,
      ],
      ['없는 계정', () => Promise.resolve(BigInt(999_999))],
    ])('%s이면 NotFoundException', async (_label, makeId) => {
      await expect(
        service.adminSeller(await admin(), await makeId()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('adminCreateSeller', () => {
    it('계정·자격증명·프로필·매장을 만들고 변경 강제 플래그와 audit(ACCOUNT/CREATE, storeId)을 남긴다', async () => {
      const actor = await admin();

      const result = await service.adminCreateSeller(actor, validInput);

      expect(result.username).toBe('cake.shop_1');
      expect(result.mustChangePassword).toBe(true);
      expect(result.profile).toEqual({
        businessName: '케이크샵 A',
        businessPhone: '02-1111-2222',
        websiteUrl: 'https://cake.example',
      });
      expect(result.store?.storeName).toBe('케이크샵 A 강남점');
      expect(result.store?.isActive).toBe(true);

      const credential = await prisma.accountCredential.findUniqueOrThrow({
        where: { username: 'cake.shop_1' },
      });
      expect(
        await argon2.verify(credential.password_hash, 'Strong!Pass1'),
      ).toBe(true);
      const store = await prisma.store.findFirstOrThrow({
        where: { seller_account_id: credential.account_id },
      });
      expect(store.latitude?.toString()).toBe('37.5012');
      expect(store.map_provider).toBe('NAVER');
      expect(store.region_id).toBeNull();

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { target_type: 'ACCOUNT', target_id: credential.account_id },
      });
      expect(audit).toMatchObject({
        actor_account_id: actor,
        store_id: store.id,
        action: 'CREATE',
      });
    });

    it('활성 2차 지역은 region_id로 연결된다', async () => {
      const group = await createRegion(prisma, { level: 1 });
      const district = await createRegion(prisma, {
        level: 2,
        parent_id: group.id,
      });

      const result = await service.adminCreateSeller(await admin(), {
        ...validInput,
        store: { ...validInput.store, regionId: district.id.toString() },
      });

      const store = await prisma.store.findUniqueOrThrow({
        where: { id: BigInt(result.store!.id) },
      });
      expect(store.region_id).toBe(district.id);
    });

    // 지정 불가 지역 전수: 1차 그룹·비활성 2차·없는 ID
    it.each([
      ['1차 지역', async () => (await createRegion(prisma, { level: 1 })).id],
      [
        '비활성 2차 지역',
        async () =>
          (await createRegion(prisma, { level: 2, is_active: false })).id,
      ],
      ['없는 지역', () => Promise.resolve(BigInt(999_999))],
    ])('%s을 regionId로 주면 BadRequestException', async (_label, makeId) => {
      await expect(
        service.adminCreateSeller(await admin(), {
          ...validInput,
          store: { ...validInput.store, regionId: (await makeId()).toString() },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('regionId 빈 문자열은 BadRequestException(값 없음으로 보지 않는다)', async () => {
      await expect(
        service.adminCreateSeller(await admin(), {
          ...validInput,
          store: { ...validInput.store, regionId: '' },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it.each([
      ['숫자 아님', { latitude: 'north' }],
      ['NaN', { latitude: 'NaN' }],
      ['Infinity', { longitude: 'Infinity' }],
      ['위도 범위 밖', { latitude: '91' }],
      ['경도 범위 밖', { longitude: '-180.5' }],
    ])('좌표 %s이면 BadRequestException', async (_label, coords) => {
      await expect(
        service.adminCreateSeller(await admin(), {
          ...validInput,
          store: { ...validInput.store, ...coords },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('이미 쓰이는 username(관리자 것 포함)이면 BadRequestException', async () => {
      const actor = await admin();
      await createAccountCredential(prisma, {
        account_type: 'ADMIN',
        username: 'taken.name',
      });

      await expect(
        service.adminCreateSeller(actor, {
          ...validInput,
          username: 'taken.name',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('감사 기록이 실패하면 계정·매장도 롤백된다(같은 트랜잭션)', async () => {
      const actor = await admin();
      const auditLogs = service['auditLogs'];
      const spy = jest
        .spyOn(auditLogs, 'createAuditLog')
        .mockRejectedValueOnce(new Error('audit down'));

      await expect(
        service.adminCreateSeller(actor, validInput),
      ).rejects.toThrow('audit down');
      expect(
        await prisma.account.count({ where: { account_type: 'SELLER' } }),
      ).toBe(0);
      expect(await prisma.store.count()).toBe(0);
      spy.mockRestore();
    });
  });

  describe('adminResetSellerPassword', () => {
    it('비밀번호를 교체하고 변경을 강제하며 세션을 전부 폐기하고 audit을 남긴다', async () => {
      const actor = await admin();
      const { account, store } = await makeSeller();
      const session = await createRefreshSession(prisma, {
        account_id: account.id,
      });

      const ok = await service.adminResetSellerPassword(actor, {
        accountId: account.id.toString(),
        newPassword: 'Reset!Pass9',
      });

      expect(ok).toBe(true);
      const credential = await prisma.accountCredential.findUniqueOrThrow({
        where: { account_id: account.id },
      });
      expect(await argon2.verify(credential.password_hash, 'Reset!Pass9')).toBe(
        true,
      );
      expect(credential.must_change_password).toBe(true);
      expect(credential.password_updated_at).not.toBeNull();
      const revoked = await prisma.authRefreshSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      expect(revoked.revoked_at).not.toBeNull();
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: {
          target_type: 'ACCOUNT',
          target_id: account.id,
          action: 'UPDATE',
        },
      });
      expect(audit.actor_account_id).toBe(actor);
      expect(audit.store_id).toBe(store.id);
    });

    it.each([
      [
        '자격증명 없는 판매자',
        async () => (await setupSellerWithStore(prisma)).account.id,
      ],
      [
        '자격증명이 삭제된 판매자',
        async () => {
          const { account, credential } = await makeSeller();
          await prisma.accountCredential.update({
            where: { id: credential.id },
            data: { deleted_at: new Date() },
          });
          return account.id;
        },
      ],
      [
        'USER 계정',
        async () =>
          (await createAccountCredential(prisma, { account_type: 'USER' }))
            .account_id,
      ],
      ['없는 계정', () => Promise.resolve(BigInt(999_999))],
    ])('%s이면 NotFoundException', async (_label, makeId) => {
      await expect(
        service.adminResetSellerPassword(await admin(), {
          accountId: (await makeId()).toString(),
          newPassword: 'Reset!Pass9',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
