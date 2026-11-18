import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { SettlementRepository } from '@/features/order/repositories/settlement.repository';
import { StoreSettlementAccountRepository } from '@/features/order/repositories/store-settlement-account.repository';
import { SellerSettlementService } from '@/features/order/services/order-settlement-seller.service';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { AccountCipher } from '@/global/crypto/account-cipher.service';
import { createTestAccountCipher } from '@/test/account-cipher';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createFinalizedOrder,
  createSettlement,
  createStore,
  setupSellerWithStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';

describe('SellerSettlementService (real DB)', () => {
  let service: SellerSettlementService;
  let cipher: AccountCipher;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerSettlementService,
        StoreSellerRepository,
        StoreSettlementAccountRepository,
        SettlementRepository,
        ...outboxPublisherProviders(),
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        { provide: AccountCipher, useValue: createTestAccountCipher() },
      ],
    });
    service = module.get(SellerSettlementService);
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

  const input = {
    bankCode: '090',
    accountHolder: '홍길동',
    accountNumber: '3333-01-2345678',
  };

  it('등록 전이면 null이다', async () => {
    const { account } = await setupSellerWithStore(prisma);
    expect(await service.sellerSettlementAccount(account.id)).toBeNull();
  });

  it('등록하면 내 매장 계좌로 저장하고 끝 4자리만 내려준다', async () => {
    const { account, store } = await setupSellerWithStore(prisma);

    const out = await service.sellerUpsertSettlementAccount(account.id, input);

    const expected = {
      bank: { code: '090', name: '카카오뱅크' },
      accountHolder: '홍길동',
      accountNumberMasked: '****5678',
      updatedByRole: 'SELLER',
    };
    expect(out).toMatchObject(expected);
    expect(JSON.stringify(out)).not.toContain('3333012345678');
    expect(await service.sellerSettlementAccount(account.id)).toMatchObject(
      expected,
    );

    const row = await prisma.storeSettlementAccount.findUniqueOrThrow({
      where: { store_id: store.id },
    });
    expect(row.updated_by_account_id).toBe(account.id);
    expect(cipher.decrypt(row.account_number_enc, 'settlement-account')).toBe(
      '3333012345678',
    );
    const [audit] = await prisma.auditLog.findMany({
      where: { target_type: 'SETTLEMENT_ACCOUNT' },
    });
    expect(audit).toMatchObject({
      actor_account_id: account.id,
      store_id: store.id,
      action: 'CREATE',
      before_json: null,
      after_json: {
        bank_code: '090',
        account_holder: '홍길동',
        account_number_last4: '5678',
      },
    });
  });

  it('관리자가 바꾼 계좌는 판매자가 다시 바꾸면 SELLER로 돌아온다', async () => {
    const { account, store } = await setupSellerWithStore(prisma);
    const admin = await createAccount(prisma, { account_type: 'ADMIN' });
    await prisma.storeSettlementAccount.create({
      data: {
        store_id: store.id,
        bank_code: '004',
        account_holder: '대리 입력',
        account_number_enc: cipher.encrypt('11112222', 'settlement-account'),
        account_number_last4: '2222',
        updated_by_account_id: admin.id,
        updated_by_role: 'ADMIN',
      },
    });
    expect(await service.sellerSettlementAccount(account.id)).toMatchObject({
      updatedByRole: 'ADMIN',
    });

    await service.sellerUpsertSettlementAccount(account.id, input);

    expect(await prisma.storeSettlementAccount.count()).toBe(1);
    expect(await service.sellerSettlementAccount(account.id)).toMatchObject({
      accountNumberMasked: '****5678',
      updatedByRole: 'SELLER',
    });
  });

  it.each([
    [{ bankCode: '04' }, 'INVALID_BANK_CODE'],
    [{ accountNumber: '1234-567' }, 'INVALID_ACCOUNT_NUMBER'],
    [{ accountHolder: '' }, 'TEXT_REQUIRED'],
  ])('잘못된 입력 %p은 %s로 거절하고 저장하지 않는다', async (patch, code) => {
    const { account } = await setupSellerWithStore(prisma);
    await expect(
      service.sellerUpsertSettlementAccount(account.id, { ...input, ...patch }),
    ).rejects.toThrowDomain(code);
    expect(await prisma.storeSettlementAccount.count()).toBe(0);
  });

  it('판매자가 아니거나 매장이 없으면 거절한다', async () => {
    const buyer = await createAccount(prisma, { account_type: 'USER' });
    await expect(
      service.sellerSettlementAccount(buyer.id),
    ).rejects.toThrowDomain('SELLER_ONLY');
    const storeless = await createAccount(prisma, { account_type: 'SELLER' });
    await expect(
      service.sellerUpsertSettlementAccount(storeless.id, input),
    ).rejects.toThrowDomain('STORE_NOT_FOUND');
  });

  describe('sellerSettlements·sellerSettlement', () => {
    const PAID_AT = new Date('2026-11-17T02:00:00.000Z');

    it('내 매장 정산만 최근 생성 순으로 키셋 커서로 넘긴다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const other = await createStore(prisma);
      const oldest = await createSettlement(prisma, {
        store_id: store.id,
        period_start: new Date('2026-11-02T00:00:00.000Z'),
      });
      const paid = await createSettlement(prisma, {
        store_id: store.id,
        period_start: new Date('2026-11-09T00:00:00.000Z'),
        order_count: 2,
        settlement_base_amount: 40_001,
        commission_amount: 2_220,
        payout_amount: 37_781,
        status: 'PAID',
        paid_at: PAID_AT,
      });
      const latest = await createSettlement(prisma, { store_id: store.id });
      await createSettlement(prisma, { store_id: other.id });

      const first = await service.sellerSettlements(account.id, { limit: 2 });
      expect(first.items.map((i) => i.id)).toEqual([
        latest.id.toString(),
        paid.id.toString(),
      ]);
      expect(first).toMatchObject({ totalCount: 3, hasMore: true });
      expect(first.items[1]).toEqual({
        id: paid.id.toString(),
        periodStart: '2026-11-09',
        periodEnd: '2026-11-15',
        orderCount: 2,
        settlementBaseAmount: 40_001,
        commissionAmount: 2_220,
        payoutAmount: 37_781,
        status: 'PAID',
        paidAt: PAID_AT,
        createdAt: paid.created_at,
      });

      const second = await service.sellerSettlements(account.id, {
        limit: 2,
        cursor: first.nextCursor!,
      });
      expect(second.items.map((i) => i.id)).toEqual([oldest.id.toString()]);
      expect(second).toMatchObject({ hasMore: false, nextCursor: null });
    });

    it('상세는 포함 주문(주문 id 순)과 송금 계좌 끝 4자리를 내려준다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const finalizedAt = new Date('2026-11-12T05:00:00.000Z');
      const orders = [
        await createFinalizedOrder(prisma, {
          store_id: store.id,
          finalized_at: finalizedAt,
          base_amount: 30_000,
          commission_rate_bps: 555,
          product_name_snapshot: '딸기 케이크',
        }),
        await createFinalizedOrder(prisma, {
          store_id: store.id,
          finalized_at: finalizedAt,
          base_amount: 7_000,
          status: 'NO_SHOW',
        }),
      ];
      const settlement = await createSettlement(prisma, {
        store_id: store.id,
        status: 'PAID',
        paid_at: PAID_AT,
      });
      await prisma.settlement.update({
        where: { id: settlement.id },
        data: {
          paid_bank_code: '090',
          paid_account_holder: '홍길동',
          paid_account_number_enc: cipher.encrypt(
            '33330123455678',
            'settlement-account',
          ),
          paid_account_last4: '5678',
        },
      });
      await prisma.order.updateMany({
        where: { id: { in: orders.map((o) => o.id) } },
        data: { settlement_id: settlement.id },
      });

      const detail = await service.sellerSettlement(account.id, settlement.id);

      expect(detail.paidAccount).toEqual({
        bank: { code: '090', name: '카카오뱅크' },
        accountHolder: '홍길동',
        accountNumberMasked: '****5678',
      });
      expect(detail.orders).toEqual([
        {
          orderId: orders[0].id.toString(),
          orderNumber: orders[0].order_number,
          productName: '딸기 케이크',
          status: 'PICKED_UP',
          commissionRateBps: 555,
          settlementBaseAmount: 30_000,
          commissionAmount: 1_665,
          payoutAmount: 28_335,
          settlementFinalizedAt: finalizedAt,
        },
        expect.objectContaining({
          orderId: orders[1].id.toString(),
          status: 'NO_SHOW',
          payoutAmount: 7_000,
        }),
      ]);
    });

    it('송금 전 정산은 송금 계좌가 null이고, 다른 매장·없는 정산은 SETTLEMENT_NOT_FOUND다', async () => {
      const { account, store } = await setupSellerWithStore(prisma);
      const mine = await createSettlement(prisma, { store_id: store.id });
      const others = await createSettlement(prisma);

      await expect(
        service.sellerSettlement(account.id, mine.id),
      ).resolves.toMatchObject({
        status: 'PENDING',
        paidAccount: null,
        orders: [],
      });
      await expect(
        service.sellerSettlement(account.id, others.id),
      ).rejects.toThrowDomain('SETTLEMENT_NOT_FOUND');
      await expect(
        service.sellerSettlement(account.id, others.id + 100n),
      ).rejects.toThrowDomain('SETTLEMENT_NOT_FOUND');
    });
  });
});
