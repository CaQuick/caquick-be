import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { DepositRecordRepository } from '@/features/order/repositories/deposit-record.repository';
import { RefundRepository } from '@/features/order/repositories/refund.repository';
import { AdminRefundMutationResolver } from '@/features/order/resolvers/order-refund-admin-mutation.resolver';
import { AdminRefundQueryResolver } from '@/features/order/resolvers/order-refund-admin-query.resolver';
import { AdminRefundService } from '@/features/order/services/order-refund-admin.service';
import type { PrismaClient } from '@/generated/prisma/client';
import type { JwtUser } from '@/global/auth';
import { AccountCipher } from '@/global/crypto/account-cipher.service';
import { createTestAccountCipher } from '@/test/account-cipher';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createOrder, createRefund } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { outboxPublisherProviders } from '@/test/outbox';

// 상세 분기는 order-refund-admin.service.spec. 여기서는 리졸버 → 서비스 → DB 배선과 ID 파싱만 본다.
describe('Admin Refund Resolvers (real DB)', () => {
  let queryResolver: AdminRefundQueryResolver;
  let mutationResolver: AdminRefundMutationResolver;
  let cipher: AccountCipher;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        AdminRefundQueryResolver,
        AdminRefundMutationResolver,
        AdminRefundService,
        AccountAdminRepository,
        RefundRepository,
        DepositRecordRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        { provide: AccountCipher, useValue: createTestAccountCipher() },
        ...outboxPublisherProviders(),
      ],
    });
    queryResolver = module.get(AdminRefundQueryResolver);
    mutationResolver = module.get(AdminRefundMutationResolver);
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

  it('환불 목록·상세를 조회하고 ID 문자열로 송금 완료한다', async () => {
    const admin = await createAccount(prisma, { account_type: 'ADMIN' });
    const user = { accountId: admin.id.toString() } as JwtUser;
    const refund = await createRefund(prisma, {
      status: 'AWAITING_TRANSFER',
      account_number_enc: cipher.encrypt('12345678', 'refund-account'),
    });

    const list = await queryResolver.adminRefunds(user, {});
    expect(list.items.map((i) => i.id)).toEqual([refund.id.toString()]);
    await expect(
      queryResolver.adminRefund(user, refund.id.toString()),
    ).resolves.toMatchObject({
      refund: { id: refund.id.toString() },
      accountNumber: '12345678',
    });

    await expect(
      mutationResolver.adminCompleteRefund(user, {
        refundId: refund.id.toString(),
      }),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('입금 반환·종결·연결 mutation과 입금 기록 목록이 이어진다', async () => {
    const admin = await createAccount(prisma, { account_type: 'ADMIN' });
    const user = { accountId: admin.id.toString() } as JwtUser;
    const order = await createOrder(prisma, { status: 'CANCELED' });

    const returned = await mutationResolver.adminCreateDepositReturn(user, {
      orderId: order.id.toString(),
      amount: 10_000,
      depositorName: '차차',
    });
    const closed = await mutationResolver.adminRecordUnidentifiedDeposit(user, {
      amount: 20_000,
      depositorName: '모르는분',
      note: '주문 없음',
    });
    const linked = await mutationResolver.adminLinkUnidentifiedDeposit(user, {
      depositRecordId: closed.id,
      orderId: order.id.toString(),
    });

    expect(returned.kind).toBe('RETURN');
    expect(linked).toMatchObject({ id: closed.id, kind: 'RETURN' });
    const records = await queryResolver.adminDepositRecords(user, {
      kind: 'RETURN',
    });
    expect(records.totalCount).toBe(2);
  });
});
