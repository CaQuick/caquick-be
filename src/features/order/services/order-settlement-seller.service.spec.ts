import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { StoreSettlementAccountRepository } from '@/features/order/repositories/store-settlement-account.repository';
import { SellerSettlementService } from '@/features/order/services/order-settlement-seller.service';
import { StoreSellerRepository } from '@/features/store/repositories/store-seller.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { AccountCipher } from '@/global/crypto/account-cipher.service';
import { createTestAccountCipher } from '@/test/account-cipher';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, setupSellerWithStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

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
});
