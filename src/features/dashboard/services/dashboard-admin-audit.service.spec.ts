import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { AdminAuditService } from '@/features/dashboard/services/dashboard-admin-audit.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createAccountCredential } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AdminAuditService (real DB)', () => {
  let service: AdminAuditService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminAuditService,
        AccountAdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
      ],
    });
    service = module.get(AdminAuditService);
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

  async function log(args: {
    actor: bigint;
    storeId?: bigint | null;
    targetType?: 'STORE' | 'ACCOUNT' | 'BANNER';
    targetId?: bigint;
    action?: 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE';
    createdAt?: Date;
  }) {
    return prisma.auditLog.create({
      data: {
        actor_account_id: args.actor,
        store_id: args.storeId ?? null,
        target_type: args.targetType ?? 'STORE',
        target_id: args.targetId ?? BigInt(1),
        action: args.action ?? 'UPDATE',
        before_json: { a: 1 },
        ...(args.createdAt ? { created_at: args.createdAt } : {}),
      },
    });
  }

  it('전역 최신순, 행위자 종류 동반, before/after는 JSON 문자열, totalCount 동반', async () => {
    const seller = await createAccount(prisma, { account_type: 'SELLER' });
    const actor = await admin();
    const l1 = await log({ actor: seller.id });
    const l2 = await log({ actor, targetType: 'ACCOUNT', action: 'CREATE' });

    const result = await service.adminAuditLogs(actor);

    expect(result.items.map((x) => x.id)).toEqual([
      l2.id.toString(),
      l1.id.toString(),
    ]);
    expect(result.items[0].actorAccountType).toBe('ADMIN');
    expect(result.items[1].actorAccountType).toBe('SELLER');
    expect(result.items[1].beforeJson).toBe('{"a":1}');
    expect(result.items[0].afterJson).toBeNull();
    expect(result.totalCount).toBe(2);
  });

  it.each([
    ['이름과 아이디', '이찬우', 'chanwoo7', false, '이찬우(chanwoo7)'],
    ['이름만(자격증명 없음)', '이찬우', null, false, '이찬우'],
    ['아이디만', null, 'chanwoo7', false, 'chanwoo7'],
    [
      '삭제된 자격증명의 아이디는 쓰지 않음',
      '이찬우',
      'chanwoo7',
      true,
      '이찬우',
    ],
    ['둘 다 없음', null, null, false, null],
  ] as const)(
    '행위자 라벨: %s',
    async (_case, name, username, credentialDeleted, expected) => {
      const viewer = await admin();
      const actor = await createAccount(prisma, {
        account_type: 'SELLER',
        name,
      });
      if (username) {
        const credential = await createAccountCredential(prisma, {
          account_id: actor.id,
          username,
        });
        if (credentialDeleted) {
          await prisma.accountCredential.update({
            where: { id: credential.id },
            data: { deleted_at: new Date() },
          });
        }
      }
      await log({ actor: actor.id });

      const result = await service.adminAuditLogs(viewer);

      expect(result.items[0].actorLabel).toBe(expected);
    },
  );

  it('계정 행이 없는 행위자는 종류·라벨 모두 null', async () => {
    const viewer = await admin();
    await log({ actor: BigInt(999_999) });

    const result = await service.adminAuditLogs(viewer);

    expect(result.items[0]).toMatchObject({
      actorAccountType: null,
      actorLabel: null,
    });
  });

  // 필터 축 전수
  it.each([
    ['actorAccountId', (a: bigint) => ({ actorAccountId: a.toString() })],
    ['storeId', () => ({ storeId: '77' })],
    ['targetType', () => ({ targetType: 'BANNER' as const })],
    ['targetId', () => ({ targetId: '5' })],
    ['action', () => ({ action: 'DELETE' as const })],
  ])('%s 필터는 해당 건만 남긴다', async (_label, makeInput) => {
    const a = await admin();
    const b = await admin();
    const target = await log({
      actor: a,
      storeId: BigInt(77),
      targetType: 'BANNER',
      targetId: BigInt(5),
      action: 'DELETE',
    });
    await log({
      actor: b,
      storeId: BigInt(78),
      targetType: 'STORE',
      targetId: BigInt(6),
      action: 'UPDATE',
    });

    const result = await service.adminAuditLogs(a, makeInput(a));
    expect(result.items.map((x) => x.id)).toEqual([target.id.toString()]);
  });

  it('기간 필터·limit+1 페이지·지워진 행위자는 종류 null', async () => {
    const actor = await admin();
    const ghost = await createAccount(prisma, { account_type: 'USER' });
    const old = await log({
      actor,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const mid = await log({
      actor: ghost.id,
      createdAt: new Date('2026-06-01T00:00:00Z'),
    });
    await log({ actor, createdAt: new Date('2026-09-01T00:00:00Z') });
    await prisma.account.update({
      where: { id: ghost.id },
      data: { deleted_at: new Date() },
    });

    const ranged = await service.adminAuditLogs(actor, {
      fromCreatedAt: new Date('2026-01-01T00:00:00Z'),
      toCreatedAt: new Date('2026-06-30T00:00:00Z'),
    });
    expect(ranged.items.map((x) => x.id)).toEqual([
      mid.id.toString(),
      old.id.toString(),
    ]);
    // 탈퇴 계정도 soft-delete라 계정 행은 남아 종류·라벨이 붙는다
    expect(ranged.items[0].actorAccountType).toBe('USER');
    expect(ranged.items[0].actorLabel).toBe(ghost.name);

    const page = await service.adminAuditLogs(actor, { limit: 2 });
    expect(page.hasMore).toBe(true);
    expect(page.items).toHaveLength(2);
    const next = await service.adminAuditLogs(actor, {
      limit: 2,
      cursor: page.nextCursor!,
    });
    expect(next.items.map((x) => x.id)).toEqual([old.id.toString()]);
    expect(next.hasMore).toBe(false);
  });
});
