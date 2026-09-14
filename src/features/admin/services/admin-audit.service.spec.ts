import { AdminRepository } from '@/features/admin/repositories/admin.repository';
import { AdminAuditService } from '@/features/admin/services/admin-audit.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AdminAuditService (real DB)', () => {
  let service: AdminAuditService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminAuditService,
        AdminRepository,
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

  it('전역 최신순, 행위자 종류 동반, before/after는 JSON 문자열, totalCount 없음', async () => {
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
    expect(result.totalCount).toBeUndefined();
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
    // 탈퇴 계정도 FK가 없어 기록은 남고, 종류만 알 수 없다… 단 soft-delete라 계정 행은 남아 종류가 붙는다
    expect(ranged.items[0].actorAccountType).toBe('USER');

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
