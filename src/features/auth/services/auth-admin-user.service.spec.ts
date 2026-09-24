import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { AdminUserService } from '@/features/auth/services/auth-admin-user.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { TokenBlacklistService } from '@/global/auth';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createAccountIdentity,
  createOrder,
  createOrderItem,
  createRefreshSession,
  createReview,
  createUserProfile,
  setupSellerWithStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AdminUserService (real DB)', () => {
  const blacklist = {
    blockStatus: jest.fn().mockResolvedValue(undefined),
    clearStatus: jest.fn().mockResolvedValue(undefined),
  };
  afterEach(() => {
    blacklist.blockStatus.mockClear();
    blacklist.clearStatus.mockClear();
  });
  let service: AdminUserService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminUserService,
        { provide: TokenBlacklistService, useValue: blacklist },
        AccountAdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    service = module.get(AdminUserService);
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

  async function makeUser(
    overrides: {
      nickname?: string;
      email?: string;
      name?: string;
      status?: 'ACTIVE' | 'SUSPENDED';
    } = {},
  ) {
    const account = await createAccount(prisma, {
      account_type: 'USER',
      email: overrides.email,
      name: overrides.name,
      status: overrides.status,
    });
    await createUserProfile(prisma, {
      account_id: account.id,
      nickname: overrides.nickname,
    });
    return account;
  }

  async function statusOf(accountId: bigint): Promise<string> {
    return (
      await prisma.account.findUniqueOrThrow({ where: { id: accountId } })
    ).status;
  }

  describe('adminUsers', () => {
    it('USER 계정만 최신 가입순으로 반환하고 프로필·연동·집계를 합친다', async () => {
      const first = await makeUser({ nickname: 'first' });
      await createAccountIdentity(prisma, {
        account_id: first.id,
        provider: 'KAKAO',
      });
      const second = await makeUser({ nickname: 'second' });
      await createAccount(prisma, { account_type: 'SELLER' });
      await createAccount(prisma, { account_type: 'ADMIN' });

      const result = await service.adminUsers(await admin());

      expect(result.totalCount).toBe(2);
      expect(result.items.map((u) => u.accountId)).toEqual([
        second.id.toString(),
        first.id.toString(),
      ]);
      expect(result.items[1].nickname).toBe('first');
      expect(result.items[1].identityProviders).toEqual(['KAKAO']);
      expect(result.items[1].orderCount).toBe(0);
    });

    // keyword가 닿는 축 전수: 닉네임·이메일·이름
    it.each([
      ['닉네임', { nickname: 'needle_nick' }, 'needle_n'],
      ['이메일', { email: 'needle@example.com' }, 'needle@'],
      ['이름', { name: '바늘 사용자' }, '바늘'],
    ])('keyword는 %s 부분일치로 찾는다', async (_label, overrides, keyword) => {
      const target = await makeUser(overrides);
      await makeUser();

      const result = await service.adminUsers(await admin(), { keyword });

      expect(result.totalCount).toBe(1);
      expect(result.items[0].accountId).toBe(target.id.toString());
    });

    it('status 필터가 목록과 totalCount에 적용된다', async () => {
      await makeUser({ status: 'SUSPENDED' });
      await makeUser();

      const result = await service.adminUsers(await admin(), {
        status: 'SUSPENDED',
      });

      expect(result.totalCount).toBe(1);
      expect(result.items[0].status).toBe('SUSPENDED');
    });

    it('limit+1 조회로 hasMore·nextCursor를 판정한다', async () => {
      const ids = [
        (await makeUser()).id,
        (await makeUser()).id,
        (await makeUser()).id,
      ];

      const page1 = await service.adminUsers(await admin(), { limit: 2 });
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBe(ids[1].toString());

      const page2 = await service.adminUsers(await admin(), {
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.items.map((u) => u.accountId)).toEqual([ids[0].toString()]);
    });
  });

  describe('adminUser', () => {
    it('주문·리뷰 집계는 삭제를 제외하고 세며 탈퇴한 소셜 연동은 빠진다', async () => {
      const user = await makeUser();
      const order = await createOrder(prisma, { account_id: user.id });
      await createOrder(prisma, {
        account_id: user.id,
        deleted_at: new Date(),
      });
      const item = await createOrderItem(prisma, { order_id: order.id });
      await createReview(prisma, { order_item_id: item.id });
      const deletedItem = await createOrderItem(prisma, { order_id: order.id });
      const deletedReview = await createReview(prisma, {
        order_item_id: deletedItem.id,
      });
      await prisma.review.update({
        where: { id: deletedReview.id },
        data: { deleted_at: new Date() },
      });
      await createAccountIdentity(prisma, {
        account_id: user.id,
        provider: 'GOOGLE',
      });
      const kakao = await createAccountIdentity(prisma, {
        account_id: user.id,
        provider: 'KAKAO',
      });
      await prisma.accountIdentity.update({
        where: { id: kakao.id },
        data: { deleted_at: new Date() },
      });

      const result = await service.adminUser(await admin(), user.id);

      expect(result.orderCount).toBe(1);
      expect(result.reviewCount).toBe(1);
      expect(result.identityProviders).toEqual(['GOOGLE']);
      expect(result.onboardingCompleted).toBe(true);
    });

    it('온보딩 미완료·프로필 없음도 그대로 드러낸다', async () => {
      const pending = await createAccount(prisma, { account_type: 'USER' });
      await createUserProfile(prisma, {
        account_id: pending.id,
        onboarding_completed_at: null,
      });
      const bare = await createAccount(prisma, { account_type: 'USER' });

      const a = await service.adminUser(await admin(), pending.id);
      expect(a.onboardingCompleted).toBe(false);
      expect(a.nickname).not.toBeNull();

      const b = await service.adminUser(await admin(), bare.id);
      expect(b.onboardingCompleted).toBe(false);
      expect(b.nickname).toBeNull();
    });

    it.each([
      [
        'SELLER 계정',
        async () =>
          (await createAccount(prisma, { account_type: 'SELLER' })).id,
      ],
      ['없는 계정', () => Promise.resolve(BigInt(999_999))],
    ])('%s이면 404', async (_label, makeId) => {
      await expect(
        service.adminUser(await admin(), await makeId()),
      ).rejects.toThrowDomain(404);
    });
  });

  describe('adminSuspendAccount', () => {
    it('반증: 상태 변경 시각은 이전 값보다 항상 크다 — 같은 ms의 재정지·복제본 시계 편차에서도 버전이 뒤집히지 않게', async () => {
      const actor = await admin();
      const user = await makeUser();
      const future = new Date(Date.now() + 60 * 60 * 1000);
      await prisma.account.update({
        where: { id: user.id },
        data: { status_changed_at: future },
      });

      await service.adminSuspendAccount(actor, {
        accountId: user.id.toString(),
        reason: '재정지',
      });

      const after = await prisma.account.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(after.status_changed_at?.getTime()).toBe(future.getTime() + 1);
      expect(blacklist.blockStatus).toHaveBeenCalledWith(
        user.id,
        'SUSPENDED',
        after.status_changed_at,
      );
    });

    it('USER를 정지하고 세션을 폐기하며 audit(ACCOUNT/STATUS_CHANGE, reason)을 남긴다', async () => {
      const actor = await admin();
      const user = await makeUser();
      const session = await createRefreshSession(prisma, {
        account_id: user.id,
      });

      const result = await service.adminSuspendAccount(actor, {
        accountId: user.id.toString(),
        reason: '  욕설 반복  ',
      });

      expect(result).toEqual({
        accountId: user.id.toString(),
        accountType: 'USER',
        status: 'SUSPENDED',
      });
      expect(await statusOf(user.id)).toBe('SUSPENDED');
      // 커밋 뒤 블랙리스트 — 만료 전 액세스 토큰까지 즉시 막는다(P2 03)
      expect(blacklist.blockStatus).toHaveBeenCalledWith(
        user.id,
        'SUSPENDED',
        (await prisma.account.findUniqueOrThrow({ where: { id: user.id } }))
          .status_changed_at,
      );
      const revoked = await prisma.authRefreshSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      expect(revoked.revoked_at).not.toBeNull();
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { target_type: 'ACCOUNT', target_id: user.id },
      });
      expect(audit.action).toBe('STATUS_CHANGE');
      expect(audit.after_json).toEqual({
        status: 'SUSPENDED',
        reason: '욕설 반복',
      });
      expect(audit.store_id).toBeNull();
    });

    it('SELLER도 정지할 수 있고 audit에 매장 ID가 붙는다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);

      const result = await service.adminSuspendAccount(await admin(), {
        accountId: account.id.toString(),
        reason: '정책 위반',
      });

      expect(result.accountType).toBe('SELLER');
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { target_type: 'ACCOUNT', target_id: account.id },
      });
      expect(audit.store_id).toBe(store.id);
    });

    it('이미 정지된 계정은 그대로 반환하고 audit을 남기지 않는다(멱등)', async () => {
      const user = await makeUser({ status: 'SUSPENDED' });

      const result = await service.adminSuspendAccount(await admin(), {
        accountId: user.id.toString(),
        reason: '재정지',
      });

      expect(result.status).toBe('SUSPENDED');
      expect(
        await prisma.auditLog.count({ where: { target_id: user.id } }),
      ).toBe(0);
      expect(blacklist.blockStatus).not.toHaveBeenCalled();
    });

    // 대상 불가 전수: 본인·다른 ADMIN → FORBIDDEN, 탈퇴·미존재 → NOT_FOUND
    it('본인은 FORBIDDEN', async () => {
      const actor = await admin();
      await expect(
        service.adminSuspendAccount(actor, {
          accountId: actor.toString(),
          reason: 'x',
        }),
      ).rejects.toThrowDomain(403);
      expect(await statusOf(actor)).toBe('ACTIVE');
    });

    it('다른 ADMIN 계정은 FORBIDDEN', async () => {
      const other = await admin();
      await expect(
        service.adminSuspendAccount(await admin(), {
          accountId: other.toString(),
          reason: 'x',
        }),
      ).rejects.toThrowDomain(403);
    });

    it.each([
      [
        '탈퇴 계정',
        async () =>
          (await createAccount(prisma, { deleted_at: new Date() })).id,
      ],
      ['없는 계정', () => Promise.resolve(BigInt(999_999))],
    ])('%s은 404', async (_label, makeId) => {
      await expect(
        service.adminSuspendAccount(await admin(), {
          accountId: (await makeId()).toString(),
          reason: 'x',
        }),
      ).rejects.toThrowDomain(404);
    });

    it('PENDING 계정은 정지할 수 없다(400) — 복구 시 승인 없이 ACTIVE가 되는 경로 차단', async () => {
      const pending = await createAccount(prisma, {
        account_type: 'USER',
        status: 'PENDING',
      });
      await expect(
        service.adminSuspendAccount(await admin(), {
          accountId: pending.id.toString(),
          reason: 'x',
        }),
      ).rejects.toThrowDomain(400);
      expect(await statusOf(pending.id)).toBe('PENDING');
    });

    it('두 관리자가 동시에 정지해도 감사 기록은 1건만 남는다(조건부 갱신)', async () => {
      const user = await makeUser();
      const [a, b] = [await admin(), await admin()];

      const results = await Promise.all([
        service.adminSuspendAccount(a, {
          accountId: user.id.toString(),
          reason: 'a',
        }),
        service.adminSuspendAccount(b, {
          accountId: user.id.toString(),
          reason: 'b',
        }),
      ]);

      expect(results.map((r) => r.status)).toEqual(['SUSPENDED', 'SUSPENDED']);
      expect(await statusOf(user.id)).toBe('SUSPENDED');
      expect(
        await prisma.auditLog.count({
          where: { target_type: 'ACCOUNT', target_id: user.id },
        }),
      ).toBe(1);
    });

    it('감사 기록이 실패하면 상태 변경도 롤백된다(같은 트랜잭션)', async () => {
      const user = await makeUser();
      const auditLogs = service['auditLogs'];
      const spy = jest
        .spyOn(auditLogs, 'recordAudit')
        .mockRejectedValueOnce(new Error('audit down'));

      await expect(
        service.adminSuspendAccount(await admin(), {
          accountId: user.id.toString(),
          reason: 'x',
        }),
      ).rejects.toThrow('audit down');
      expect(await statusOf(user.id)).toBe('ACTIVE');
      spy.mockRestore();
    });
  });

  describe('adminReinstateAccount', () => {
    it('정지된 계정을 ACTIVE로 되돌리고 audit을 남긴다(세션은 건드리지 않음)', async () => {
      const user = await makeUser({ status: 'SUSPENDED' });

      const result = await service.adminReinstateAccount(
        await admin(),
        user.id,
      );

      expect(result.status).toBe('ACTIVE');
      expect(await statusOf(user.id)).toBe('ACTIVE');
      // 상태 키만 — 자격증명 cutoff는 남는다
      expect(blacklist.clearStatus).toHaveBeenCalledWith(
        user.id,
        (await prisma.account.findUniqueOrThrow({ where: { id: user.id } }))
          .status_changed_at,
      );
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { target_type: 'ACCOUNT', target_id: user.id },
      });
      expect(audit.before_json).toEqual({ status: 'SUSPENDED' });
      expect(audit.after_json).toEqual({ status: 'ACTIVE', reason: null });
    });

    it('이미 ACTIVE면 그대로 반환한다(멱등)', async () => {
      const user = await makeUser();
      const result = await service.adminReinstateAccount(
        await admin(),
        user.id,
      );
      expect(result.status).toBe('ACTIVE');
      expect(
        await prisma.auditLog.count({ where: { target_id: user.id } }),
      ).toBe(0);
      expect(blacklist.clearStatus).not.toHaveBeenCalled();
    });

    it('PENDING 계정은 복구할 수 없다(400)', async () => {
      const pending = await createAccount(prisma, {
        account_type: 'USER',
        status: 'PENDING',
      });
      await expect(
        service.adminReinstateAccount(await admin(), pending.id),
      ).rejects.toThrowDomain(400);
      expect(await statusOf(pending.id)).toBe('PENDING');
    });

    it('ADMIN 계정은 FORBIDDEN', async () => {
      const other = await createAccount(prisma, {
        account_type: 'ADMIN',
        status: 'SUSPENDED',
      });
      await expect(
        service.adminReinstateAccount(await admin(), other.id),
      ).rejects.toThrowDomain(403);
    });
  });
});
