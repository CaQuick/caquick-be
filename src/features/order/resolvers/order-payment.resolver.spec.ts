// 분기/검증 세부는 order-payment-admin.service.spec.ts·order-settlement-seller.service.spec.ts에서 담당. 여기서는 리졸버→서비스→DB 경로만 본다.

import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { PAYMENT_BANKS } from '@/features/order/constants/payment-banks';
import { PaymentSettingRepository } from '@/features/order/repositories/payment-setting.repository';
import { StoreSettlementAccountRepository } from '@/features/order/repositories/store-settlement-account.repository';
import { AdminPaymentMutationResolver } from '@/features/order/resolvers/order-payment-admin-mutation.resolver';
import { AdminPaymentQueryResolver } from '@/features/order/resolvers/order-payment-admin-query.resolver';
import { PaymentQueryResolver } from '@/features/order/resolvers/order-payment-query.resolver';
import { SellerSettlementMutationResolver } from '@/features/order/resolvers/order-settlement-seller-mutation.resolver';
import { SellerSettlementQueryResolver } from '@/features/order/resolvers/order-settlement-seller-query.resolver';
import { AdminPaymentService } from '@/features/order/services/order-payment-admin.service';
import { SellerSettlementService } from '@/features/order/services/order-settlement-seller.service';
import { StoreAdminRepository } from '@/features/store/repositories/store-admin.repository';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { AccountCipher } from '@/global/crypto/account-cipher.service';
import { createTestAccountCipher } from '@/test/account-cipher';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('결제 설정·정산 계좌 Resolvers (real DB)', () => {
  let banks: PaymentQueryResolver;
  let adminQuery: AdminPaymentQueryResolver;
  let adminMutation: AdminPaymentMutationResolver;
  let sellerQuery: SellerSettlementQueryResolver;
  let sellerMutation: SellerSettlementMutationResolver;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        PaymentQueryResolver,
        AdminPaymentQueryResolver,
        AdminPaymentMutationResolver,
        SellerSettlementQueryResolver,
        SellerSettlementMutationResolver,
        AdminPaymentService,
        SellerSettlementService,
        AccountAdminRepository,
        StoreAdminRepository,
        StoreSellerRepository,
        PaymentSettingRepository,
        StoreSettlementAccountRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        { provide: AccountCipher, useValue: createTestAccountCipher() },
      ],
    });
    banks = module.get(PaymentQueryResolver);
    adminQuery = module.get(AdminPaymentQueryResolver);
    adminMutation = module.get(AdminPaymentMutationResolver);
    sellerQuery = module.get(SellerSettlementQueryResolver);
    sellerMutation = module.get(SellerSettlementMutationResolver);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('은행 목록은 상수 그대로다', () => {
    expect(banks.paymentBanks()).toEqual(PAYMENT_BANKS);
  });

  it('관리자: 결제 설정 변경 → 조회', async () => {
    const actor = await createAccount(prisma, { account_type: 'ADMIN' });
    const user = {
      accountId: actor.id.toString(),
      accountType: 'ADMIN' as const,
    };

    await adminMutation.adminUpdatePaymentSetting(user, {
      commissionRateBps: 500,
      reason: '수수료 5%',
    });

    expect(await adminQuery.adminPaymentSetting(user)).toMatchObject({
      commissionRateBps: 500,
      depositBank: null,
    });
  });

  it('판매자 등록 → 관리자 원문 조회 → 관리자 대리 수정 → 판매자 조회', async () => {
    const actor = await createAccount(prisma, { account_type: 'ADMIN' });
    const adminUser = {
      accountId: actor.id.toString(),
      accountType: 'ADMIN' as const,
    };
    const { account, store } = await setupSellerWithStore(prisma);
    const sellerUser = {
      accountId: account.id.toString(),
      accountType: 'SELLER' as const,
    };

    await sellerMutation.sellerUpsertSettlementAccount(sellerUser, {
      bankCode: '088',
      accountHolder: '케이크샵',
      accountNumber: '110-123-456789',
    });
    expect(
      await adminQuery.adminStoreSettlementAccount(
        adminUser,
        store.id.toString(),
      ),
    ).toMatchObject({ accountNumber: '110123456789', updatedByRole: 'SELLER' });

    await adminMutation.adminUpsertStoreSettlementAccount(adminUser, {
      storeId: store.id.toString(),
      bankCode: '004',
      accountHolder: '케이크샵',
      accountNumber: '12345678',
      reason: '판매자 요청',
    });
    expect(await sellerQuery.sellerSettlementAccount(sellerUser)).toMatchObject(
      {
        bank: { code: '004' },
        accountNumberMasked: '****5678',
        updatedByRole: 'ADMIN',
      },
    );
  });
});
