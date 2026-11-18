import { AccountNumberReencryptRepository } from '@/features/order/repositories/account-number-reencrypt.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { AccountCipher } from '@/global/crypto/account-cipher.service';
import { testAccountKey } from '@/test/account-cipher';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createOrder, createStore } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('AccountNumberReencryptRepository (real DB)', () => {
  let prisma: PrismaClient;
  const k1 = testAccountKey('k1');
  const k2 = testAccountKey('k2');
  const oldCipher = new AccountCipher({ keys: [k1] });
  const rotated = new AccountCipher({ keys: [k2, k1] });

  beforeAll(async () => {
    ({ prisma } = await createTestingModuleWithRealDb({ providers: [] }));
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  const repoWith = (cipher: AccountCipher) =>
    new AccountNumberReencryptRepository(prisma, cipher);

  // 재암호화가 updated_at을 건드리는지 가리려고 과거 시각으로 만든다
  const PAST = new Date('2026-01-01T00:00:00.000Z');

  /** 세 칼럼에 k1 토큰을 하나씩, 환불은 계좌 미입력 행과 이미 k2인 행도 둔다. */
  async function seedTokens() {
    const store = await createStore(prisma);
    const order = await createOrder(prisma);
    const refund = (token: string | null) =>
      prisma.refund.create({
        data: {
          order_id: order.id,
          kind: 'DEPOSIT_RETURN',
          amount: 1000,
          requested_at: new Date(),
          account_number_enc: token,
          updated_at: PAST,
        },
      });
    const stale = await refund(
      oldCipher.encrypt('1111222233', 'refund-account'),
    );
    await refund(null);
    const fresh = await refund(rotated.encrypt('9999888877', 'refund-account'));
    const account = await prisma.storeSettlementAccount.create({
      data: {
        store_id: store.id,
        bank_code: '004',
        account_holder: '케이크샵',
        account_number_enc: oldCipher.encrypt('44445555', 'settlement-account'),
        account_number_last4: '5555',
        updated_by_account_id: store.seller_account_id,
        updated_by_role: 'SELLER',
        updated_at: PAST,
      },
    });
    const settlement = await prisma.settlement.create({
      data: {
        store_id: store.id,
        store_name_snapshot: store.store_name,
        period_start: new Date('2026-11-09'),
        period_end: new Date('2026-11-15'),
        order_count: 1,
        settlement_base_amount: 1000,
        commission_amount: 0,
        payout_amount: 1000,
        paid_account_number_enc: oldCipher.encrypt(
          '44445555',
          'settlement-account',
        ),
        updated_at: PAST,
      },
    });
    return { stale, fresh, account, settlement };
  }

  it('첫 키가 아닌 토큰만 대상으로 세고, 재암호화 뒤에는 0이며 원문이 그대로 풀린다', async () => {
    const { stale, fresh, account, settlement } = await seedTokens();
    const repo = repoWith(rotated);
    const freshBefore = (
      await prisma.refund.findUniqueOrThrow({ where: { id: fresh.id } })
    ).account_number_enc;

    const target = { refund: 1, storeSettlementAccount: 1, settlement: 1 };
    expect(await repo.countStale()).toEqual(target);
    expect(await repo.reencryptStale()).toEqual(target);
    expect(await repo.countStale()).toEqual({
      refund: 0,
      storeSettlementAccount: 0,
      settlement: 0,
    });

    const refundRow = await prisma.refund.findUniqueOrThrow({
      where: { id: stale.id },
    });
    const accountRow = await prisma.storeSettlementAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    const settlementRow = await prisma.settlement.findUniqueOrThrow({
      where: { id: settlement.id },
    });
    const refundToken = refundRow.account_number_enc!;
    const accountToken = accountRow.account_number_enc;
    const paidToken = settlementRow.paid_account_number_enc!;
    for (const token of [refundToken, accountToken, paidToken]) {
      expect(token.startsWith('v1.k2.')).toBe(true);
    }
    // '마지막 변경 시각'은 키 회전으로 움직이지 않는다
    for (const row of [refundRow, accountRow, settlementRow]) {
      expect(row.updated_at).toEqual(PAST);
    }
    // 옛 키를 뺀 뒤에도 풀린다 — 회전 마지막 단계(옛 키 제거)의 전제
    const newOnly = new AccountCipher({ keys: [k2] });
    expect(newOnly.decrypt(refundToken, 'refund-account')).toBe('1111222233');
    expect(newOnly.decrypt(accountToken, 'settlement-account')).toBe(
      '44445555',
    );
    expect(newOnly.decrypt(paidToken, 'settlement-account')).toBe('44445555');
    expect(
      (await prisma.refund.findUniqueOrThrow({ where: { id: fresh.id } }))
        .account_number_enc,
    ).toBe(freshBefore);
  });

  it('읽은 뒤 다른 요청이 바꾼 행은 건너뛰어 updated_at을 되돌리지 않고, 다음 실행 대상으로 남긴다', async () => {
    const { stale } = await seedTokens();
    const findMany = prisma.refund.findMany.bind(prisma.refund);
    // 재암호화가 행을 읽은 직후 같은 환불의 상태가 바뀐다(토큰은 그대로)
    const race = jest
      .spyOn(prisma.refund, 'findMany')
      .mockImplementationOnce((async (args: Parameters<typeof findMany>[0]) => {
        const rows = await findMany(args);
        await prisma.refund.update({
          where: { id: stale.id },
          data: { status: 'AWAITING_TRANSFER' },
        });
        return rows;
      }) as unknown as typeof prisma.refund.findMany);

    try {
      expect((await repoWith(rotated).reencryptStale()).refund).toBe(0);
    } finally {
      race.mockRestore();
    }

    const row = await prisma.refund.findUniqueOrThrow({
      where: { id: stale.id },
    });
    expect(row.status).toBe('AWAITING_TRANSFER');
    expect(row.updated_at.getTime()).toBeGreaterThan(PAST.getTime());
    expect(row.account_number_enc!.startsWith('v1.k1.')).toBe(true);
    expect((await repoWith(rotated).countStale()).refund).toBe(1);
  });

  it('대상은 첫 키 기준이다 — 첫 키가 k1이면 k2 토큰만 센다', async () => {
    await seedTokens();
    expect(await repoWith(oldCipher).countStale()).toEqual({
      refund: 1,
      storeSettlementAccount: 0,
      settlement: 0,
    });
  });
});
