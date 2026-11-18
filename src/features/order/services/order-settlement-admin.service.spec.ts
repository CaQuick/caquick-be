import { ClockService } from '@/common/providers/clock.service';
import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { SettlementRepository } from '@/features/order/repositories/settlement.repository';
import { StoreSettlementAccountRepository } from '@/features/order/repositories/store-settlement-account.repository';
import { AdminSettlementService } from '@/features/order/services/order-settlement-admin.service';
import type { PrismaClient, Store } from '@/generated/prisma/client';
import { AccountCipher } from '@/global/crypto/account-cipher.service';
import { createTestAccountCipher } from '@/test/account-cipher';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createFinalizedOrder,
  createSettlement,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';

// 2026-11-17(화) 11:00 KST
const NOW = new Date('2026-11-17T02:00:00.000Z');
const dateOnly = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

describe('AdminSettlementService (real DB)', () => {
  let service: AdminSettlementService;
  let auditLogs: IAuditLogRepository;
  let cipher: AccountCipher;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminSettlementService,
        AccountAdminRepository,
        SettlementRepository,
        StoreSettlementAccountRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        { provide: AccountCipher, useValue: createTestAccountCipher() },
        { provide: ClockService, useValue: { now: () => NOW } },
        ...outboxPublisherProviders({ clock: true }),
      ],
    });
    service = module.get(AdminSettlementService);
    auditLogs = module.get(AUDIT_LOG_REPOSITORY);
    cipher = module.get(AccountCipher);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function admin(name = '김운영'): Promise<bigint> {
    return (await createAccount(prisma, { account_type: 'ADMIN', name })).id;
  }

  async function registerAccount(
    store: Store,
    accountNumber = '33330123455678',
  ): Promise<void> {
    await prisma.storeSettlementAccount.upsert({
      where: { store_id: store.id },
      create: {
        store_id: store.id,
        bank_code: '090',
        account_holder: '홍길동',
        account_number_enc: cipher.encrypt(accountNumber, 'settlement-account'),
        account_number_last4: accountNumber.slice(-4),
        updated_by_account_id: 1n,
        updated_by_role: 'SELLER',
      },
      update: {
        bank_code: '004',
        account_holder: '바뀐 예금주',
        account_number_enc: cipher.encrypt(accountNumber, 'settlement-account'),
        account_number_last4: accountNumber.slice(-4),
      },
    });
  }

  describe('adminSettlements', () => {
    it('최근 생성 순·키셋 커서로 넘기고 매장 정산 계좌 등록 여부를 붙인다', async () => {
      const adminId = await admin();
      const registered = await createStore(prisma);
      const missing = await createStore(prisma);
      await registerAccount(registered);
      const a = await createSettlement(prisma, { store_id: registered.id });
      const b = await createSettlement(prisma, {
        store_id: missing.id,
        store_name_snapshot: '해즈 케이크',
        period_start: dateOnly('2026-11-09'),
        period_end: dateOnly('2026-11-15'),
      });
      const c = await createSettlement(prisma, { store_id: registered.id });

      const first = await service.adminSettlements(adminId, { limit: 2 });
      expect(first.items.map((i) => [i.id, i.accountRegistered])).toEqual([
        [c.id.toString(), true],
        [b.id.toString(), false],
      ]);
      expect(first).toMatchObject({ totalCount: 3, hasMore: true });
      expect(first.items[1]).toEqual({
        id: b.id.toString(),
        storeId: missing.id.toString(),
        storeName: '해즈 케이크',
        periodStart: '2026-11-09',
        periodEnd: '2026-11-15',
        orderCount: 1,
        settlementBaseAmount: 10_000,
        commissionAmount: 0,
        payoutAmount: 10_000,
        status: 'PENDING',
        paidAt: null,
        accountRegistered: false,
        createdAt: b.created_at,
      });

      const second = await service.adminSettlements(adminId, {
        limit: 2,
        cursor: first.nextCursor!,
      });
      expect(second.items.map((i) => i.id)).toEqual([a.id.toString()]);
      expect(second).toMatchObject({ hasMore: false, nextCursor: null });
    });

    it('상태·매장·기간 시작일 필터는 AND로 묶이고, null은 생략과 같다', async () => {
      const adminId = await admin();
      const store = await createStore(prisma);
      const target = await createSettlement(prisma, {
        store_id: store.id,
        period_start: dateOnly('2026-11-09'),
      });
      await createSettlement(prisma, {
        store_id: store.id,
        period_start: dateOnly('2026-11-02'),
      });
      await createSettlement(prisma, {
        store_id: store.id,
        period_start: dateOnly('2026-10-26'),
        status: 'PAID',
        paid_at: NOW,
      });
      await createSettlement(prisma, { period_start: dateOnly('2026-11-09') });

      const found = await service.adminSettlements(adminId, {
        status: 'PENDING',
        storeId: store.id.toString(),
        periodStart: ' 2026-11-09 ',
      });
      expect(found.items.map((i) => i.id)).toEqual([target.id.toString()]);
      expect(found.totalCount).toBe(1);

      const paid = await service.adminSettlements(adminId, { status: 'PAID' });
      expect(paid.totalCount).toBe(1);

      const all = await service.adminSettlements(adminId, {
        status: null,
        storeId: null,
        periodStart: null,
        cursor: null,
        limit: null,
      } as never);
      expect(all.totalCount).toBe(4);
      expect((await service.adminSettlements(adminId)).totalCount).toBe(4);
    });

    it.each([
      [{ periodStart: '2026-11-9' }, 'INVALID_DATE'],
      [{ periodStart: '2026-02-30' }, 'INVALID_DATE'],
      [{ periodStart: '' }, 'INVALID_DATE'],
      [{ storeId: '' }, 'INVALID_ID'],
      [{ cursor: 'abc' }, 'INVALID_CURSOR'],
    ])('잘못된 입력 %p은 %s다', async (input, code) => {
      const adminId = await admin();
      await expect(
        service.adminSettlements(adminId, input),
      ).rejects.toThrowDomain(code);
    });

    it('관리자가 아니면 거절한다', async () => {
      const buyer = await createAccount(prisma, { account_type: 'USER' });
      await expect(service.adminSettlements(buyer.id)).rejects.toThrowDomain(
        'ADMIN_ONLY',
      );
    });
  });

  describe('adminSettlement·adminMarkSettlementPaid', () => {
    async function settlementWithOrders(store: Store) {
      const settlement = await createSettlement(prisma, {
        store_id: store.id,
        order_count: 1,
        settlement_base_amount: 30_000,
        commission_amount: 1_665,
        payout_amount: 28_335,
      });
      const order = await createFinalizedOrder(prisma, {
        store_id: store.id,
        finalized_at: new Date('2026-11-12T05:00:00.000Z'),
        base_amount: 30_000,
        commission_rate_bps: 555,
      });
      await prisma.order.update({
        where: { id: order.id },
        data: { settlement_id: settlement.id },
      });
      return { settlement, order };
    }

    it('상세는 포함 주문과 지금 매장 정산 계좌 원문을 내려주고, 송금 전이면 송금 계좌가 없다', async () => {
      const adminId = await admin();
      const store = await createStore(prisma);
      await registerAccount(store);
      const { settlement, order } = await settlementWithOrders(store);

      const detail = await service.adminSettlement(adminId, settlement.id);

      expect(detail).toMatchObject({
        id: settlement.id.toString(),
        status: 'PENDING',
        accountRegistered: true,
        paidAt: null,
        paidByLabel: null,
        paidNote: null,
        paidAccount: null,
        currentAccount: {
          storeId: store.id.toString(),
          bank: { code: '090', name: '카카오뱅크' },
          accountHolder: '홍길동',
          accountNumber: '33330123455678',
          accountNumberMasked: '****5678',
        },
      });
      expect(detail.orders).toEqual([
        expect.objectContaining({
          orderId: order.id.toString(),
          settlementBaseAmount: 30_000,
          commissionAmount: 1_665,
          payoutAmount: 28_335,
        }),
      ]);
      await expect(
        service.adminSettlement(adminId, settlement.id + 100n),
      ).rejects.toThrowDomain('SETTLEMENT_NOT_FOUND');
    });

    it('송금 완료는 그때 계좌를 스냅샷하고 처리자·메모·감사(끝 4자리만)를 남긴다', async () => {
      const adminId = await admin('김운영');
      const store = await createStore(prisma);
      await registerAccount(store);
      const { settlement } = await settlementWithOrders(store);

      const out = await service.adminMarkSettlementPaid(adminId, {
        settlementId: settlement.id.toString(),
        note: ' 카카오 11:05 이체 ',
      });

      expect(out).toMatchObject({
        status: 'PAID',
        paidAt: NOW,
        paidByLabel: '김운영',
        paidNote: '카카오 11:05 이체',
        paidAccount: {
          bank: { code: '090', name: '카카오뱅크' },
          accountHolder: '홍길동',
          accountNumberMasked: '****5678',
        },
      });
      const row = await prisma.settlement.findUniqueOrThrow({
        where: { id: settlement.id },
      });
      expect(row.paid_by_account_id).toBe(adminId);
      expect(
        cipher.decrypt(row.paid_account_number_enc!, 'settlement-account'),
      ).toBe('33330123455678');
      const [audit] = await prisma.auditLog.findMany({
        where: { target_type: 'SETTLEMENT' },
      });
      expect(audit).toMatchObject({
        actor_account_id: adminId,
        store_id: store.id,
        target_id: settlement.id,
        action: 'STATUS_CHANGE',
        before_json: { status: 'PENDING' },
        after_json: {
          status: 'PAID',
          payoutAmount: 28_335,
          bank_code: '090',
          account_holder: '홍길동',
          account_number_last4: '5678',
          note: '카카오 11:05 이체',
        },
      });
      expect(JSON.stringify(audit.after_json)).not.toContain('33330123455678');

      // 송금 뒤 계좌가 바뀌어도 송금 계좌는 그대로, 현재 계좌는 새 값
      await registerAccount(store, '11112222333344');
      const after = await service.adminSettlement(adminId, settlement.id);
      expect(after.paidAccount?.accountNumberMasked).toBe('****5678');
      expect(after.currentAccount?.accountNumber).toBe('11112222333344');
    });

    it('이미 송금 완료면 SETTLEMENT_ALREADY_PAID이고 처음 기록은 그대로다', async () => {
      const adminId = await admin();
      const store = await createStore(prisma);
      await registerAccount(store);
      const { settlement } = await settlementWithOrders(store);
      await service.adminMarkSettlementPaid(adminId, {
        settlementId: settlement.id.toString(),
        note: '처음',
      });

      await expect(
        service.adminMarkSettlementPaid(await admin('다른 운영자'), {
          settlementId: settlement.id.toString(),
          note: '두 번째',
        }),
      ).rejects.toThrowDomain('SETTLEMENT_ALREADY_PAID');
      const row = await prisma.settlement.findUniqueOrThrow({
        where: { id: settlement.id },
      });
      expect(row.paid_note).toBe('처음');
      expect(
        await prisma.auditLog.count({ where: { target_type: 'SETTLEMENT' } }),
      ).toBe(1);
    });

    it('동시에 두 번 눌러도 한 번만 송금 완료된다', async () => {
      const adminId = await admin();
      const store = await createStore(prisma);
      await registerAccount(store);
      const { settlement } = await settlementWithOrders(store);
      const input = { settlementId: settlement.id.toString() };

      const results = await Promise.allSettled([
        service.adminMarkSettlementPaid(adminId, input),
        service.adminMarkSettlementPaid(adminId, input),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected?.reason).toMatchObject({
        code: 'SETTLEMENT_ALREADY_PAID',
      });
    });

    it('매장 정산 계좌가 없으면 SETTLEMENT_ACCOUNT_REQUIRED이고 송금 대기로 남는다', async () => {
      const adminId = await admin();
      const store = await createStore(prisma);
      const { settlement } = await settlementWithOrders(store);

      await expect(
        service.adminMarkSettlementPaid(adminId, {
          settlementId: settlement.id.toString(),
        }),
      ).rejects.toThrowDomain('SETTLEMENT_ACCOUNT_REQUIRED');
      await expect(
        service.adminSettlement(adminId, settlement.id),
      ).resolves.toMatchObject({
        status: 'PENDING',
        accountRegistered: false,
        currentAccount: null,
      });
    });

    it('감사 기록이 실패하면 송금 완료도 남지 않는다(같은 트랜잭션)', async () => {
      const adminId = await admin();
      const store = await createStore(prisma);
      await registerAccount(store);
      const { settlement } = await settlementWithOrders(store);
      jest
        .spyOn(auditLogs, 'recordAudit')
        .mockRejectedValueOnce(new Error('audit down'));

      await expect(
        service.adminMarkSettlementPaid(adminId, {
          settlementId: settlement.id.toString(),
        }),
      ).rejects.toThrow('audit down');
      const row = await prisma.settlement.findUniqueOrThrow({
        where: { id: settlement.id },
      });
      expect(row).toMatchObject({ status: 'PENDING', paid_at: null });
    });

    it.each([
      [{ settlementId: '999' }, 'SETTLEMENT_NOT_FOUND'],
      [{ settlementId: '' }, 'INVALID_ID'],
      [{ settlementId: '1', note: '가'.repeat(501) }, 'TEXT_TOO_LONG'],
    ])('잘못된 입력 %p은 %s다', async (input, code) => {
      const adminId = await admin();
      await expect(
        service.adminMarkSettlementPaid(adminId, input),
      ).rejects.toThrowDomain(code);
    });
  });

  describe('adminMonthlyCommissions', () => {
    it('정산 확정 시각의 KST 월로 매장별 건수·기준액·수수료를 묶는다(경계·삭제·미확정 제외)', async () => {
      const adminId = await admin();
      const hazz = await createStore(prisma);
      const other = await createStore(prisma);
      const finalize = (
        store: Store,
        at: string,
        base: number,
        name?: string,
      ) =>
        createFinalizedOrder(prisma, {
          store_id: store.id,
          finalized_at: new Date(at),
          base_amount: base,
          commission_rate_bps: 500,
          ...(name ? { store_name_snapshot: name } : {}),
        });
      // 10-31 23:59:59.999 KST — 10월
      await finalize(hazz, '2026-10-31T14:59:59.999Z', 99_000);
      // 11-01 00:00 KST, 11-30 23:59:59.999 KST — 11월
      await finalize(hazz, '2026-10-31T15:00:00.000Z', 20_000, '옛 이름');
      await finalize(hazz, '2026-11-30T14:59:59.999Z', 10_010, '해즈 케이크');
      // 12-01 00:00 KST — 12월
      await finalize(hazz, '2026-11-30T15:00:00.000Z', 99_000);
      await finalize(other, '2026-11-10T00:00:00.000Z', 5_000, '다른 매장');
      const deleted = await finalize(other, '2026-11-10T00:00:00.000Z', 7_000);
      await prisma.order.update({
        where: { id: deleted.id },
        data: { deleted_at: NOW },
      });

      const report = await service.adminMonthlyCommissions(adminId, {
        month: ' 2026-11 ',
      });

      // 수수료 5%: 20000 → 1000, 10010 → 500(500.5 버림), 5000 → 250
      expect(report).toEqual({
        month: '2026-11',
        orderCount: 3,
        settlementBaseAmount: 35_010,
        commissionAmount: 1_750,
        stores: [
          {
            storeId: hazz.id.toString(),
            storeName: '해즈 케이크',
            orderCount: 2,
            settlementBaseAmount: 30_010,
            commissionAmount: 1_500,
          },
          {
            storeId: other.id.toString(),
            storeName: '다른 매장',
            orderCount: 1,
            settlementBaseAmount: 5_000,
            commissionAmount: 250,
          },
        ],
      });
    });

    it('매장명은 생성 순서가 아니라 그 달 가장 늦게 확정된 주문의 스냅샷이다', async () => {
      const store = await createStore(prisma);
      await createFinalizedOrder(prisma, {
        store_id: store.id,
        finalized_at: new Date('2026-11-20T00:00:00.000Z'),
        store_name_snapshot: '나중 확정(새 이름)',
      });
      await createFinalizedOrder(prisma, {
        store_id: store.id,
        finalized_at: new Date('2026-11-05T00:00:00.000Z'),
        store_name_snapshot: '먼저 확정(옛 이름)',
      });

      const report = await service.adminMonthlyCommissions(await admin(), {
        month: '2026-11',
      });

      expect(report.stores).toEqual([
        expect.objectContaining({
          storeName: '나중 확정(새 이름)',
          orderCount: 2,
        }),
      ]);
    });

    it('확정 주문이 없는 달은 빈 집계다', async () => {
      await expect(
        service.adminMonthlyCommissions(await admin(), { month: '2027-01' }),
      ).resolves.toEqual({
        month: '2027-01',
        orderCount: 0,
        settlementBaseAmount: 0,
        commissionAmount: 0,
        stores: [],
      });
    });

    it.each(['2026-13', '2026-1', 'x', ''])(
      '월 형식 %p는 INVALID_YEAR_MONTH다',
      async (month) => {
        await expect(
          service.adminMonthlyCommissions(await admin(), { month }),
        ).rejects.toThrowDomain('INVALID_YEAR_MONTH');
      },
    );
  });
});
