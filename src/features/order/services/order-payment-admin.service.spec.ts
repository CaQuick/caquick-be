import {
  AUDIT_LOG_REPOSITORY,
  type IAuditLogRepository,
} from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { PaymentSettingRepository } from '@/features/order/repositories/payment-setting.repository';
import { StoreSettlementAccountRepository } from '@/features/order/repositories/store-settlement-account.repository';
import { AdminPaymentService } from '@/features/order/services/order-payment-admin.service';
import { StoreAdminRepository } from '@/features/store/repositories/store-admin.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { AccountCipher } from '@/global/crypto/account-cipher.service';
import { createTestAccountCipher } from '@/test/account-cipher';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createPaymentSetting,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AdminPaymentService (real DB)', () => {
  let service: AdminPaymentService;
  let auditLogs: IAuditLogRepository;
  let cipher: AccountCipher;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminPaymentService,
        AccountAdminRepository,
        PaymentSettingRepository,
        StoreSettlementAccountRepository,
        StoreAdminRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        { provide: AccountCipher, useValue: createTestAccountCipher() },
      ],
    });
    service = module.get(AdminPaymentService);
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

  async function admin(): Promise<bigint> {
    return (await createAccount(prisma, { account_type: 'ADMIN' })).id;
  }

  /** 감사 기록 단계에서 실패시킨다(장애 주입) — 같은 트랜잭션이면 본 write도 남지 않아야 한다. */
  function failAuditOnce(): void {
    jest
      .spyOn(auditLogs, 'recordAudit')
      .mockRejectedValueOnce(new Error('audit down'));
  }

  const auditsOf = (targetType: 'PAYMENT_SETTING' | 'SETTLEMENT_ACCOUNT') =>
    prisma.auditLog.findMany({
      where: { target_type: targetType },
      orderBy: { id: 'asc' },
    });

  describe('adminPaymentSetting', () => {
    it('행이 없으면 수수료 0·입금 계좌 없음으로 읽는다', async () => {
      expect(await prisma.paymentSetting.count()).toBe(0);
      await expect(service.adminPaymentSetting(await admin())).resolves.toEqual(
        {
          commissionRateBps: 0,
          depositBank: null,
          depositAccountNumber: null,
          depositAccountHolder: null,
          updatedAt: null,
        },
      );
    });

    it('있는 행을 은행 이름과 함께 읽는다', async () => {
      await createPaymentSetting(prisma, { commission_rate_bps: 550 });
      await expect(
        service.adminPaymentSetting(await admin()),
      ).resolves.toMatchObject({
        commissionRateBps: 550,
        depositBank: { code: '004', name: 'KB국민은행' },
        depositAccountNumber: '12345678901234',
        depositAccountHolder: '케이퀵',
        updatedAt: expect.any(Date) as Date,
      });
    });

    it('관리자가 아니면 거절한다', async () => {
      const seller = await createAccount(prisma, { account_type: 'SELLER' });
      await expect(
        service.adminPaymentSetting(seller.id),
      ).rejects.toThrowDomain('ADMIN_ONLY');
    });
  });

  describe('adminUpdatePaymentSetting', () => {
    it('행이 없으면 첫 변경이 행을 만들고 기본값을 변경 전으로 감사에 남긴다', async () => {
      const actor = await admin();
      const out = await service.adminUpdatePaymentSetting(actor, {
        commissionRateBps: 300,
        depositBankCode: '088',
        depositAccountNumber: '140-012-345678',
        depositAccountHolder: ' 케이퀵 ',
        reason: '입금 계좌 개설',
      });

      expect(out).toMatchObject({
        commissionRateBps: 300,
        depositBank: { code: '088', name: '신한은행' },
        depositAccountNumber: '140012345678',
        depositAccountHolder: '케이퀵',
      });
      const row = await prisma.paymentSetting.findUniqueOrThrow({
        where: { id: 1 },
      });
      expect(row.updated_by_account_id).toBe(actor);
      const [audit] = await auditsOf('PAYMENT_SETTING');
      expect(audit).toMatchObject({
        actor_account_id: actor,
        store_id: null,
        target_id: 1n,
        action: 'UPDATE',
        before_json: {
          commission_rate_bps: 0,
          deposit_bank_code: null,
          deposit_account_number: null,
          deposit_account_holder: null,
        },
        after_json: {
          commission_rate_bps: 300,
          deposit_bank_code: '088',
          deposit_account_number: '140012345678',
          deposit_account_holder: '케이퀵',
          reason: '입금 계좌 개설',
        },
      });
    });

    it('보낸 필드만 바꾸고 생략·null인 필드는 그대로 둔다', async () => {
      await createPaymentSetting(prisma, { commission_rate_bps: 550 });
      const out = await service.adminUpdatePaymentSetting(await admin(), {
        commissionRateBps: null,
        depositAccountHolder: '케이퀵 주식회사',
        reason: '예금주 정정',
      });

      expect(out).toMatchObject({
        commissionRateBps: 550,
        depositBank: { code: '004' },
        depositAccountNumber: '12345678901234',
        depositAccountHolder: '케이퀵 주식회사',
      });
      const [audit] = await auditsOf('PAYMENT_SETTING');
      expect(audit.before_json).toMatchObject({
        deposit_account_holder: '케이퀵',
      });
    });

    it.each([
      [-1, false],
      [0, true],
      [10_000, true],
      [10_001, false],
      [1.5, false],
    ])('수수료율 %p bp → 허용 %p', async (bps, ok) => {
      const run = service.adminUpdatePaymentSetting(await admin(), {
        commissionRateBps: bps,
        reason: '수수료 조정',
      });
      if (ok) {
        await expect(run).resolves.toMatchObject({ commissionRateBps: bps });
      } else {
        await expect(run).rejects.toThrowDomain('INVALID_COMMISSION_RATE');
      }
    });

    it.each([
      [{ depositBankCode: '999' }, 'INVALID_BANK_CODE'],
      [{ depositAccountNumber: '1234567' }, 'INVALID_ACCOUNT_NUMBER'],
      [{ depositAccountHolder: ' ' }, 'TEXT_REQUIRED'],
      [{ reason: '   ' }, 'TEXT_REQUIRED'],
    ])(
      '잘못된 입력 %p은 %s로 거절하고 아무것도 바꾸지 않는다',
      async (patch, code) => {
        await createPaymentSetting(prisma);
        const before = await prisma.paymentSetting.findUniqueOrThrow({
          where: { id: 1 },
        });
        await expect(
          service.adminUpdatePaymentSetting(await admin(), {
            reason: '변경',
            ...patch,
          }),
        ).rejects.toThrowDomain(code);
        expect(
          await prisma.paymentSetting.findUniqueOrThrow({ where: { id: 1 } }),
        ).toEqual(before);
        expect(await auditsOf('PAYMENT_SETTING')).toHaveLength(0);
      },
    );

    it('감사 기록이 실패하면 설정 변경도 남지 않는다(같은 트랜잭션)', async () => {
      await createPaymentSetting(prisma, { commission_rate_bps: 100 });
      failAuditOnce();
      await expect(
        service.adminUpdatePaymentSetting(await admin(), {
          commissionRateBps: 900,
          reason: '변경',
        }),
      ).rejects.toThrow('audit down');
      expect(
        (await prisma.paymentSetting.findUniqueOrThrow({ where: { id: 1 } }))
          .commission_rate_bps,
      ).toBe(100);
    });

    it('행이 없을 때 동시에 바꿔도 둘 다 성공하고 행은 1개다', async () => {
      const actor = await admin();
      await Promise.all([
        service.adminUpdatePaymentSetting(actor, {
          commissionRateBps: 100,
          reason: 'a',
        }),
        service.adminUpdatePaymentSetting(actor, {
          depositBankCode: '004',
          reason: 'b',
        }),
      ]);
      const row = await prisma.paymentSetting.findUniqueOrThrow({
        where: { id: 1 },
      });
      expect(row).toMatchObject({
        commission_rate_bps: 100,
        deposit_bank_code: '004',
      });
      expect(await auditsOf('PAYMENT_SETTING')).toHaveLength(2);
    });
  });

  describe('adminStoreSettlementAccount', () => {
    it('없는 매장·삭제된 매장은 STORE_NOT_FOUND', async () => {
      const actor = await admin();
      const deleted = await createStore(prisma, { deleted_at: new Date() });
      for (const storeId of [999_999n, deleted.id]) {
        await expect(
          service.adminStoreSettlementAccount(actor, storeId),
        ).rejects.toThrowDomain('STORE_NOT_FOUND');
      }
    });

    it('등록 전이면 null, 등록 뒤에는 계좌번호 원문을 복호화해 준다', async () => {
      const actor = await admin();
      const store = await createStore(prisma);
      expect(await service.adminStoreSettlementAccount(actor, store.id)).toBe(
        null,
      );

      await service.adminUpsertStoreSettlementAccount(actor, {
        storeId: store.id.toString(),
        bankCode: '004',
        accountHolder: '케이크샵',
        accountNumber: '123-456-7890',
        reason: '판매자 요청',
      });

      expect(
        await service.adminStoreSettlementAccount(actor, store.id),
      ).toMatchObject({
        storeId: store.id.toString(),
        bank: { code: '004', name: 'KB국민은행' },
        accountHolder: '케이크샵',
        accountNumber: '1234567890',
        accountNumberMasked: '****7890',
        updatedByRole: 'ADMIN',
      });
    });
  });

  describe('adminUpsertStoreSettlementAccount', () => {
    const input = (storeId: bigint, accountNumber = '1234567890') => ({
      storeId: storeId.toString(),
      bankCode: '088',
      accountHolder: '케이크샵',
      accountNumber,
      reason: '판매자 요청',
    });

    it('없는 매장이면 STORE_NOT_FOUND이고 계좌를 만들지 않는다', async () => {
      await expect(
        service.adminUpsertStoreSettlementAccount(
          await admin(),
          input(999_999n),
        ),
      ).rejects.toThrowDomain('STORE_NOT_FOUND');
      expect(await prisma.storeSettlementAccount.count()).toBe(0);
    });

    it('계좌번호는 암호문과 끝 4자리로만 저장하고 감사에는 끝 4자리만 남긴다', async () => {
      const actor = await admin();
      const store = await createStore(prisma);
      await service.adminUpsertStoreSettlementAccount(
        actor,
        input(store.id, '1234567890'),
      );
      await service.adminUpsertStoreSettlementAccount(
        actor,
        input(store.id, '9876543210'),
      );

      const row = await prisma.storeSettlementAccount.findUniqueOrThrow({
        where: { store_id: store.id },
      });
      expect(row).toMatchObject({
        account_number_last4: '3210',
        updated_by_account_id: actor,
        updated_by_role: 'ADMIN',
      });
      expect(row.account_number_enc).not.toContain('9876543210');
      expect(cipher.decrypt(row.account_number_enc, 'settlement-account')).toBe(
        '9876543210',
      );

      const audits = await auditsOf('SETTLEMENT_ACCOUNT');
      expect(audits.map((a) => [a.action, a.store_id, a.target_id])).toEqual([
        ['CREATE', store.id, row.id],
        ['UPDATE', store.id, row.id],
      ]);
      expect(audits[1]).toMatchObject({
        before_json: { account_number_last4: '7890' },
        after_json: { account_number_last4: '3210', reason: '판매자 요청' },
      });
      const serialized = JSON.stringify(
        audits.map((a) => [a.before_json, a.after_json]),
      );
      expect(serialized).not.toContain('1234567890');
      expect(serialized).not.toContain('9876543210');
      expect(serialized).not.toContain(row.account_number_enc);
    });

    it.each([
      [{ bankCode: '000' }, 'INVALID_BANK_CODE'],
      [{ accountNumber: '1'.repeat(21) }, 'INVALID_ACCOUNT_NUMBER'],
      [{ accountHolder: '가'.repeat(51) }, 'TEXT_TOO_LONG'],
      [{ reason: '' }, 'TEXT_REQUIRED'],
      [{ storeId: '' }, 'INVALID_ID'],
    ])('잘못된 입력 %p은 %s로 거절한다', async (patch, code) => {
      const store = await createStore(prisma);
      await expect(
        service.adminUpsertStoreSettlementAccount(await admin(), {
          ...input(store.id),
          ...patch,
        }),
      ).rejects.toThrowDomain(code);
      expect(await prisma.storeSettlementAccount.count()).toBe(0);
    });

    it('감사 기록이 실패하면 계좌도 바뀌지 않는다(같은 트랜잭션)', async () => {
      const actor = await admin();
      const store = await createStore(prisma);
      await service.adminUpsertStoreSettlementAccount(actor, input(store.id));
      failAuditOnce();
      await expect(
        service.adminUpsertStoreSettlementAccount(
          actor,
          input(store.id, '5555555555'),
        ),
      ).rejects.toThrow('audit down');
      expect(
        (
          await prisma.storeSettlementAccount.findUniqueOrThrow({
            where: { store_id: store.id },
          })
        ).account_number_last4,
      ).toBe('7890');
    });

    it('첫 등록이 동시에 두 번 와도 둘 다 성공하고 행은 1개다(생성·갱신 감사 각 1건)', async () => {
      const actor = await admin();
      const store = await createStore(prisma);
      await Promise.all([
        service.adminUpsertStoreSettlementAccount(
          actor,
          input(store.id, '1111111111'),
        ),
        service.adminUpsertStoreSettlementAccount(
          actor,
          input(store.id, '2222222222'),
        ),
      ]);
      expect(await prisma.storeSettlementAccount.count()).toBe(1);
      expect(
        (await auditsOf('SETTLEMENT_ACCOUNT')).map((a) => a.action).sort(),
      ).toEqual(['CREATE', 'UPDATE']);
    });
  });
});
