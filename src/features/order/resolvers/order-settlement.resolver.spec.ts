// 분기/검증 세부는 order-settlement-admin.service.spec.ts·order-settlement-seller.service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.

import { ClockService } from '@/common/providers/clock.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { SettlementRepository } from '@/features/order/repositories/settlement.repository';
import { StoreSettlementAccountRepository } from '@/features/order/repositories/store-settlement-account.repository';
import { AdminSettlementMutationResolver } from '@/features/order/resolvers/order-settlement-admin-mutation.resolver';
import { AdminSettlementQueryResolver } from '@/features/order/resolvers/order-settlement-admin-query.resolver';
import { SellerSettlementQueryResolver } from '@/features/order/resolvers/order-settlement-seller-query.resolver';
import { AdminSettlementService } from '@/features/order/services/order-settlement-admin.service';
import { SellerSettlementService } from '@/features/order/services/order-settlement-seller.service';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import type { JwtUser } from '@/global/auth';
import { AccountCipher } from '@/global/crypto/account-cipher.service';
import { createTestAccountCipher } from '@/test/account-cipher';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createFinalizedOrder,
  createSettlement,
  setupSellerWithStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';

describe('주간 정산 Resolvers (real DB)', () => {
  let adminQuery: AdminSettlementQueryResolver;
  let adminMutation: AdminSettlementMutationResolver;
  let sellerQuery: SellerSettlementQueryResolver;
  let cipher: AccountCipher;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminSettlementQueryResolver,
        AdminSettlementMutationResolver,
        SellerSettlementQueryResolver,
        AdminSettlementService,
        SellerSettlementService,
        AccountAdminRepository,
        StoreSellerRepository,
        SettlementRepository,
        StoreSettlementAccountRepository,
        ClockService,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        { provide: AccountCipher, useValue: createTestAccountCipher() },
        ...outboxPublisherProviders({ clock: true }),
      ],
    });
    adminQuery = module.get(AdminSettlementQueryResolver);
    adminMutation = module.get(AdminSettlementMutationResolver);
    sellerQuery = module.get(SellerSettlementQueryResolver);
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

  it('판매자 정산 내역 → 관리자 목록·상세 → 송금 완료 → 판매자 상세·월 집계를 ID 문자열로 잇는다', async () => {
    const { account: seller, store } = await setupSellerWithStore(prisma);
    const sellerUser = { accountId: seller.id.toString() } as JwtUser;
    const admin = await createAccount(prisma, { account_type: 'ADMIN' });
    const adminUser = { accountId: admin.id.toString() } as JwtUser;
    await prisma.storeSettlementAccount.create({
      data: {
        store_id: store.id,
        bank_code: '090',
        account_holder: '홍길동',
        account_number_enc: cipher.encrypt(
          '33330123455678',
          'settlement-account',
        ),
        account_number_last4: '5678',
        updated_by_account_id: seller.id,
        updated_by_role: 'SELLER',
      },
    });
    const order = await createFinalizedOrder(prisma, {
      store_id: store.id,
      finalized_at: new Date('2026-11-12T05:00:00.000Z'),
    });
    const settlement = await createSettlement(prisma, { store_id: store.id });
    await prisma.order.update({
      where: { id: order.id },
      data: { settlement_id: settlement.id },
    });
    const id = settlement.id.toString();

    const mine = await sellerQuery.sellerSettlements(sellerUser, {});
    expect(mine.items.map((i) => i.id)).toEqual([id]);
    const list = await adminQuery.adminSettlements(adminUser, {
      storeId: store.id.toString(),
    });
    expect(list.items).toEqual([
      expect.objectContaining({ id, accountRegistered: true }),
    ]);
    await expect(
      adminQuery.adminSettlement(adminUser, id),
    ).resolves.toMatchObject({
      id,
      currentAccount: { accountNumber: '33330123455678' },
    });

    await expect(
      adminMutation.adminMarkSettlementPaid(adminUser, { settlementId: id }),
    ).resolves.toMatchObject({ id, status: 'PAID' });

    await expect(
      sellerQuery.sellerSettlement(sellerUser, id),
    ).resolves.toMatchObject({
      status: 'PAID',
      paidAccount: { accountNumberMasked: '****5678' },
      orders: [expect.objectContaining({ orderId: order.id.toString() })],
    });
    await expect(
      adminQuery.adminMonthlyCommissions(adminUser, { month: '2026-11' }),
    ).resolves.toMatchObject({ orderCount: 1, settlementBaseAmount: 10_000 });
  });
});
