import { ClockService } from '@/common/providers/clock.service';
import { AUDIT_LOG_REPOSITORY } from '@/features/audit-log';
import { AuditLogRepository } from '@/features/audit-log/repositories/audit-log.repository';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { NotificationAdminRepository } from '@/features/notification/repositories/notification-admin.repository';
import { NotificationRepository } from '@/features/notification/repositories/notification.repository';
import { NotificationOutboxConsumer } from '@/features/notification/services/notification-outbox.consumer';
import { REFUND_COMPLETED } from '@/features/order/events/refund-completed.event';
import { REFUND_REQUESTED } from '@/features/order/events/refund-requested.event';
import { DepositRecordRepository } from '@/features/order/repositories/deposit-record.repository';
import { RefundRepository } from '@/features/order/repositories/refund.repository';
import { AdminRefundService } from '@/features/order/services/order-refund-admin.service';
import { OutboxDispatcherService } from '@/features/outbox';
import type { OrderStatus, PrismaClient } from '@/generated/prisma/client';
import { AccountCipher } from '@/global/crypto/account-cipher.service';
import { createTestAccountCipher } from '@/test/account-cipher';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createAccount,
  createOrder,
  createOrderItem,
  createPayment,
  createRefund,
  createStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import {
  drainOutbox,
  OUTBOX_TEST_IMPORTS,
  outboxTestProviders,
} from '@/test/outbox';

// 2026-09-16(수) 16:00 KST
const NOW = new Date('2026-09-16T07:00:00.000Z');

describe('AdminRefundService (real DB)', () => {
  let service: AdminRefundService;
  let clock: ClockService;
  let cipher: AccountCipher;
  let dispatcher: OutboxDispatcherService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      imports: OUTBOX_TEST_IMPORTS,
      providers: [
        AdminRefundService,
        AccountAdminRepository,
        RefundRepository,
        DepositRecordRepository,
        { provide: AUDIT_LOG_REPOSITORY, useClass: AuditLogRepository },
        { provide: AccountCipher, useValue: createTestAccountCipher() },
        ...outboxTestProviders(),
        NotificationOutboxConsumer,
        NotificationRepository,
        NotificationAdminRepository,
      ],
    });
    service = module.get(AdminRefundService);
    clock = module.get(ClockService);
    cipher = module.get(AccountCipher);
    dispatcher = module.get(OutboxDispatcherService);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
    jest.spyOn(clock, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function admin(name: string | null = '김운영'): Promise<bigint> {
    return (await createAccount(prisma, { account_type: 'ADMIN', name })).id;
  }

  /** 품목이 있는 주문(매장·상품 스냅샷). */
  async function order(status: OrderStatus = 'CANCELED', totalPrice = 30_000) {
    const store = await createStore(prisma, { store_name: '해즈 케이크' });
    const row = await createOrder(prisma, {
      status,
      total_price: totalPrice,
      buyer_name: '차차',
      buyer_phone: '010-1234-5678',
    });
    await createOrderItem(prisma, {
      order_id: row.id,
      store_id: store.id,
      product_name_snapshot: '딸기 케이크',
    });
    return row;
  }

  describe('adminRefunds·adminRefund', () => {
    it('필터를 null로 보내면 전체를 오래된 환불부터 주문·연락처·첫 품목 스냅샷과 함께 준다', async () => {
      const adminId = await admin();
      const o = await order();
      const r1 = await createRefund(prisma, { order_id: o.id });
      const r2 = await createRefund(prisma, {
        order_id: o.id,
        kind: 'DEPOSIT_RETURN',
        status: 'AWAITING_TRANSFER',
        amount: 5_000,
      });
      const r3 = await createRefund(prisma, { status: 'COMPLETED' });

      const result = await service.adminRefunds(adminId, {
        status: null,
        kind: null,
      });

      expect(result.totalCount).toBe(3);
      expect(result.items.map((i) => i.id)).toEqual(
        [r1, r2, r3].map((r) => r.id.toString()),
      );
      expect(result.items[1]).toMatchObject({
        orderId: o.id.toString(),
        orderNumber: o.order_number,
        buyerName: '차차',
        buyerPhone: '010-1234-5678',
        storeName: '해즈 케이크',
        productName: '딸기 케이크',
        kind: 'DEPOSIT_RETURN',
        amount: 5_000,
        status: 'AWAITING_TRANSFER',
        accountNumberMasked: '****5678',
        completedByLabel: null,
      });
    });

    it('상태·종류 필터는 AND로 걸고 키셋으로 넘긴다', async () => {
      const adminId = await admin();
      const ids: bigint[] = [];
      for (let i = 0; i < 3; i++) {
        ids.push((await createRefund(prisma)).id);
      }
      await createRefund(prisma, { kind: 'DEPOSIT_RETURN' });
      await createRefund(prisma, { status: 'AWAITING_TRANSFER' });

      const first = await service.adminRefunds(adminId, {
        status: 'AWAITING_ACCOUNT',
        kind: 'CANCEL',
        limit: 2,
      });
      expect(first).toMatchObject({
        totalCount: 3,
        hasMore: true,
        nextCursor: ids[1].toString(),
      });
      const second = await service.adminRefunds(adminId, {
        status: 'AWAITING_ACCOUNT',
        kind: 'CANCEL',
        limit: 2,
        cursor: first.nextCursor!,
      });
      expect(second.items.map((i) => i.id)).toEqual([ids[2].toString()]);
      expect(second).toMatchObject({ hasMore: false, nextCursor: null });
      await expect(
        service.adminRefunds(adminId, { cursor: 'abc' }),
      ).rejects.toThrowDomain('INVALID_CURSOR');
    });

    it('상세는 계좌번호 원문과 입금 반환이면 입금 기록을 함께 준다', async () => {
      const adminId = await admin();
      const o = await order();
      const refund = await createRefund(prisma, {
        order_id: o.id,
        kind: 'DEPOSIT_RETURN',
        status: 'AWAITING_TRANSFER',
        account_number_enc: cipher.encrypt('110123455678', 'refund-account'),
      });

      const detail = await service.adminRefund(adminId, refund.id);

      expect(detail).toMatchObject({
        refund: { id: refund.id.toString(), accountNumberMasked: '****5678' },
        accountNumber: '110123455678',
        depositRecord: {
          kind: 'RETURN',
          orderId: o.id.toString(),
          orderNumber: o.order_number,
          refundId: refund.id.toString(),
          refundStatus: 'AWAITING_TRANSFER',
        },
      });
    });

    it('계좌 입력 전 취소 환불은 원문·입금 기록이 null이고, 없는 환불은 REFUND_NOT_FOUND다', async () => {
      const adminId = await admin();
      const refund = await createRefund(prisma);

      await expect(
        service.adminRefund(adminId, refund.id),
      ).resolves.toMatchObject({ accountNumber: null, depositRecord: null });
      await expect(
        service.adminRefund(adminId, refund.id + 1n),
      ).rejects.toThrowDomain('REFUND_NOT_FOUND');
    });
  });

  describe('adminCompleteRefund', () => {
    it('송금 대기 환불을 완료로 바꾸고 처리자·메모·감사·구매자 완료 알림을 남긴다', async () => {
      const adminId = await admin('김운영');
      const o = await order();
      const refund = await createRefund(prisma, {
        order_id: o.id,
        status: 'AWAITING_TRANSFER',
      });

      const result = await service.adminCompleteRefund(adminId, {
        refundId: refund.id.toString(),
        note: ' 국민 16:05 송금 ',
      });

      expect(result).toMatchObject({
        status: 'COMPLETED',
        completedAt: NOW,
        completedByLabel: '김운영',
        completeNote: '국민 16:05 송금',
      });
      await expect(
        prisma.refund.findUniqueOrThrow({ where: { id: refund.id } }),
      ).resolves.toMatchObject({ completed_by_account_id: adminId });
      const [audit] = await prisma.auditLog.findMany();
      expect(audit).toMatchObject({
        actor_account_id: adminId,
        store_id: null,
        target_type: 'REFUND',
        target_id: refund.id,
        action: 'STATUS_CHANGE',
        before_json: { status: 'AWAITING_TRANSFER' },
        after_json: {
          status: 'COMPLETED',
          amount: refund.amount,
          accountNumberLast4: '5678',
          note: '국민 16:05 송금',
        },
      });
      const events = await prisma.outbox.findMany();
      expect(events.map((e) => e.event_type)).toEqual([REFUND_COMPLETED]);

      await drainOutbox(dispatcher);
      await expect(prisma.notification.findMany()).resolves.toEqual([
        expect.objectContaining({
          account_id: o.account_id,
          event: 'REFUND_COMPLETED',
          body: `${o.order_number} 30,000원 환불이 완료되었어요.`,
          store_name: '해즈 케이크',
        }),
      ]);
    });

    it.each([
      ['AWAITING_ACCOUNT', 'REFUND_NOT_READY'],
      ['COMPLETED', 'REFUND_ALREADY_COMPLETED'],
    ] as const)(
      '%s 환불은 %s로 거절하고 아무것도 남기지 않는다',
      async (status, code) => {
        const adminId = await admin();
        const refund = await createRefund(prisma, { status });

        await expect(
          service.adminCompleteRefund(adminId, {
            refundId: refund.id.toString(),
          }),
        ).rejects.toThrowDomain(code);
        await expect(
          prisma.refund.findUniqueOrThrow({ where: { id: refund.id } }),
        ).resolves.toMatchObject({ status, completed_by_account_id: null });
        expect(await prisma.auditLog.count()).toBe(0);
        expect(await prisma.outbox.count()).toBe(0);
      },
    );

    it('없는 환불은 REFUND_NOT_FOUND, 메모 501자는 TEXT_TOO_LONG이다', async () => {
      const adminId = await admin();
      const refund = await createRefund(prisma, {
        status: 'AWAITING_TRANSFER',
      });

      await expect(
        service.adminCompleteRefund(adminId, { refundId: '999999' }),
      ).rejects.toThrowDomain('REFUND_NOT_FOUND');
      await expect(
        service.adminCompleteRefund(adminId, {
          refundId: refund.id.toString(),
          note: 'x'.repeat(501),
        }),
      ).rejects.toThrowDomain('TEXT_TOO_LONG');
    });
  });

  describe('adminCreateDepositReturn', () => {
    it('취소 환불이 있는 주문에 연결하면 반환 환불이 공존하고 주문·결제·정산은 그대로다', async () => {
      const adminId = await admin('김운영');
      const o = await order('CANCELED');
      await createPayment(prisma, {
        order_id: o.id,
        status: 'CONFIRMED',
        confirmed_at: NOW,
      });
      await prisma.order.update({
        where: { id: o.id },
        data: {
          canceled_at: NOW,
          settlement_base_amount: 10_000,
          commission_amount: 500,
          settlement_finalized_at: NOW,
        },
      });
      const cancelRefund = await createRefund(prisma, {
        order_id: o.id,
        amount: 20_000,
      });
      const orderBefore = await prisma.order.findUniqueOrThrow({
        where: { id: o.id },
        include: { payment: true },
      });

      const result = await service.adminCreateDepositReturn(adminId, {
        orderId: o.id.toString(),
        amount: 30_000,
        depositorName: ' 차차 ',
        depositedAt: new Date('2026-09-16T06:50:00.000Z'),
        note: '취소 뒤 입금',
      });

      expect(result).toMatchObject({
        kind: 'RETURN',
        orderId: o.id.toString(),
        orderNumber: o.order_number,
        amount: 30_000,
        depositorName: '차차',
        depositedAt: new Date('2026-09-16T06:50:00.000Z'),
        note: '취소 뒤 입금',
        recordedByLabel: '김운영',
        refundStatus: 'AWAITING_ACCOUNT',
        createdAt: expect.any(Date),
      });
      const refunds = await prisma.refund.findMany({
        where: { order_id: o.id },
        orderBy: { id: 'asc' },
      });
      expect(refunds).toEqual([
        expect.objectContaining({ id: cancelRefund.id, kind: 'CANCEL' }),
        expect.objectContaining({
          id: BigInt(result.refundId!),
          kind: 'DEPOSIT_RETURN',
          amount: 30_000,
          status: 'AWAITING_ACCOUNT',
          deposit_record_id: BigInt(result.id),
          requested_at: NOW,
        }),
      ]);
      await expect(
        prisma.order.findUniqueOrThrow({
          where: { id: o.id },
          include: { payment: true },
        }),
      ).resolves.toEqual(orderBefore);
      const [audit] = await prisma.auditLog.findMany();
      expect(audit).toMatchObject({
        target_type: 'DEPOSIT_RECORD',
        target_id: BigInt(result.id),
        action: 'CREATE',
        store_id: null,
        after_json: {
          kind: 'RETURN',
          orderId: o.id.toString(),
          amount: 30_000,
        },
      });
      const [requested] = await prisma.outbox.findMany();
      expect(requested).toMatchObject({
        event_type: REFUND_REQUESTED,
        payload_json: {
          refundId: result.refundId,
          kind: 'DEPOSIT_RETURN',
          amount: 30_000,
          accountSubmitted: false,
        },
      });

      await drainOutbox(dispatcher);
      await expect(prisma.notification.findMany()).resolves.toEqual([
        expect.objectContaining({
          account_id: o.account_id,
          event: 'REFUND_ACCOUNT_REQUESTED',
          body: `${o.order_number} 30,000원을 돌려받을 계좌를 입력해 주세요.`,
        }),
      ]);
    });

    it.each<OrderStatus>([
      'PENDING_PAYMENT',
      'SUBMITTED',
      'CONFIRMED',
      'MADE',
      'PICKED_UP',
      'NO_SHOW',
    ])('%s 주문에도 연결하고 상태는 바꾸지 않는다', async (status) => {
      const adminId = await admin();
      const o = await order(status);

      await service.adminCreateDepositReturn(adminId, {
        orderId: o.id.toString(),
        amount: 1,
        depositorName: '차차',
      });

      await expect(
        prisma.order.findUniqueOrThrow({ where: { id: o.id } }),
      ).resolves.toMatchObject({ status });
      expect(await prisma.refund.count()).toBe(1);
    });

    it('라벨을 만들 수 없는 관리자(이름·아이디 없음)도 기록하고 처리자 라벨은 null이다', async () => {
      const adminId = await admin(null);
      const o = await order();

      const result = await service.adminCreateDepositReturn(adminId, {
        orderId: o.id.toString(),
        amount: 30_000,
        depositorName: '차차',
      });

      expect(result).toMatchObject({
        recordedByLabel: null,
        depositedAt: null,
      });
      await expect(
        prisma.depositRecord.findFirstOrThrow(),
      ).resolves.toMatchObject({
        recorded_by_account_id: adminId,
        recorded_by_label_snapshot: null,
      });
    });

    it.each([
      ['입금액 0', { amount: 0 }, 'DEPOSIT_AMOUNT_INVALID'],
      ['입금액 음수', { amount: -1 }, 'DEPOSIT_AMOUNT_INVALID'],
      ['입금자명 공백', { depositorName: '  ' }, 'TEXT_REQUIRED'],
      ['입금자명 51자', { depositorName: '가'.repeat(51) }, 'TEXT_TOO_LONG'],
      ['메모 501자', { note: 'x'.repeat(501) }, 'TEXT_TOO_LONG'],
      ['없는 주문', { orderId: '999999' }, 'ORDER_NOT_FOUND'],
    ] as const)('%s는 %s다', async (_label, override, code) => {
      const adminId = await admin();
      const o = await order();

      await expect(
        service.adminCreateDepositReturn(adminId, {
          orderId: o.id.toString(),
          amount: 30_000,
          depositorName: '차차',
          ...override,
        }),
      ).rejects.toThrowDomain(code);
      expect(await prisma.depositRecord.count()).toBe(0);
      expect(await prisma.refund.count()).toBe(0);
    });

    it('삭제된 주문은 ORDER_NOT_FOUND다', async () => {
      const adminId = await admin();
      const deleted = await createOrder(prisma, { deleted_at: NOW });

      await expect(
        service.adminCreateDepositReturn(adminId, {
          orderId: deleted.id.toString(),
          amount: 30_000,
          depositorName: '차차',
        }),
      ).rejects.toThrowDomain('ORDER_NOT_FOUND');
    });
  });

  describe('adminRecordUnidentifiedDeposit·adminLinkUnidentifiedDeposit', () => {
    async function unidentified(adminId: bigint) {
      return service.adminRecordUnidentifiedDeposit(adminId, {
        amount: 45_000,
        depositorName: '모르는분',
        note: '입금자명·금액 일치 주문 없음',
      });
    }

    it('주인 모를 입금은 환불·이벤트 없이 메모와 함께 종결 기록하고 감사를 남긴다', async () => {
      const adminId = await admin('김운영');

      const result = await unidentified(adminId);

      expect(result).toMatchObject({
        kind: 'UNIDENTIFIED',
        orderId: null,
        orderNumber: null,
        amount: 45_000,
        note: '입금자명·금액 일치 주문 없음',
        recordedByLabel: '김운영',
        refundId: null,
        refundStatus: null,
      });
      expect(await prisma.refund.count()).toBe(0);
      expect(await prisma.outbox.count()).toBe(0);
      await expect(prisma.auditLog.findFirstOrThrow()).resolves.toMatchObject({
        target_type: 'DEPOSIT_RECORD',
        action: 'CREATE',
        after_json: { kind: 'UNIDENTIFIED', orderId: null },
      });
    });

    it.each([
      ['빈 문자열', ''],
      ['공백', '   '],
    ])('종결 메모가 %s면 DEPOSIT_NOTE_REQUIRED다', async (_label, note) => {
      const adminId = await admin();

      await expect(
        service.adminRecordUnidentifiedDeposit(adminId, {
          amount: 45_000,
          depositorName: '모르는분',
          note,
        }),
      ).rejects.toThrowDomain('DEPOSIT_NOTE_REQUIRED');
      expect(await prisma.depositRecord.count()).toBe(0);
    });

    it('주인을 찾으면 같은 기록을 반환으로 바꿔 주문에 잇고 입금액 전액 환불을 만든다', async () => {
      const adminId = await admin();
      const o = await order('CANCELED');
      const record = await unidentified(adminId);
      await prisma.auditLog.deleteMany();

      const linked = await service.adminLinkUnidentifiedDeposit(adminId, {
        depositRecordId: record.id,
        orderId: o.id.toString(),
      });

      expect(linked).toMatchObject({
        id: record.id,
        kind: 'RETURN',
        orderId: o.id.toString(),
        orderNumber: o.order_number,
        amount: 45_000,
        note: '입금자명·금액 일치 주문 없음',
        refundStatus: 'AWAITING_ACCOUNT',
      });
      expect(await prisma.depositRecord.count()).toBe(1);
      await expect(prisma.refund.findFirstOrThrow()).resolves.toMatchObject({
        id: BigInt(linked.refundId!),
        order_id: o.id,
        kind: 'DEPOSIT_RETURN',
        amount: 45_000,
        deposit_record_id: BigInt(record.id),
      });
      await expect(prisma.auditLog.findFirstOrThrow()).resolves.toMatchObject({
        action: 'UPDATE',
        before_json: { kind: 'UNIDENTIFIED', orderId: null },
        after_json: { kind: 'RETURN', orderId: o.id.toString() },
      });
      await expect(prisma.outbox.findFirstOrThrow()).resolves.toMatchObject({
        event_type: REFUND_REQUESTED,
        payload_json: { refundId: linked.refundId, kind: 'DEPOSIT_RETURN' },
      });
    });

    it('이미 반환인 기록은 DEPOSIT_RECORD_ALREADY_LINKED, 없는 기록·주문은 NOT_FOUND다', async () => {
      const adminId = await admin();
      const o = await order();
      const returned = await service.adminCreateDepositReturn(adminId, {
        orderId: o.id.toString(),
        amount: 30_000,
        depositorName: '차차',
      });
      const record = await unidentified(adminId);

      await expect(
        service.adminLinkUnidentifiedDeposit(adminId, {
          depositRecordId: returned.id,
          orderId: o.id.toString(),
        }),
      ).rejects.toThrowDomain('DEPOSIT_RECORD_ALREADY_LINKED');
      await expect(
        service.adminLinkUnidentifiedDeposit(adminId, {
          depositRecordId: '999999',
          orderId: o.id.toString(),
        }),
      ).rejects.toThrowDomain('DEPOSIT_RECORD_NOT_FOUND');
      await expect(
        service.adminLinkUnidentifiedDeposit(adminId, {
          depositRecordId: record.id,
          orderId: '999999',
        }),
      ).rejects.toThrowDomain('ORDER_NOT_FOUND');
      expect(await prisma.refund.count()).toBe(1);
    });
  });

  describe('adminDepositRecords', () => {
    it('kind를 null로 보내면 전체를 최근 기록부터, 같은 시각은 id 역순으로 넘긴다', async () => {
      const adminId = await admin();
      const o = await order();
      const a = await service.adminCreateDepositReturn(adminId, {
        orderId: o.id.toString(),
        amount: 1_000,
        depositorName: '가',
      });
      const b = await service.adminRecordUnidentifiedDeposit(adminId, {
        amount: 2_000,
        depositorName: '나',
        note: '메모',
      });
      const c = await service.adminRecordUnidentifiedDeposit(adminId, {
        amount: 3_000,
        depositorName: '다',
        note: '메모',
      });
      // 같은 시각 둘 + 더 이른 하나
      await prisma.depositRecord.updateMany({
        where: { id: { in: [BigInt(b.id), BigInt(c.id)] } },
        data: { created_at: NOW },
      });
      await prisma.depositRecord.update({
        where: { id: BigInt(a.id) },
        data: { created_at: new Date(NOW.getTime() - 1) },
      });

      const first = await service.adminDepositRecords(adminId, {
        kind: null,
        limit: 2,
      });
      expect(first.items.map((i) => i.id)).toEqual([c.id, b.id]);
      expect(first).toMatchObject({ totalCount: 3, hasMore: true });
      const second = await service.adminDepositRecords(adminId, {
        limit: 2,
        cursor: first.nextCursor!,
      });
      expect(second.items.map((i) => i.id)).toEqual([a.id]);
      expect(second.hasMore).toBe(false);

      const returns = await service.adminDepositRecords(adminId, {
        kind: 'RETURN',
      });
      expect(returns).toMatchObject({ totalCount: 1 });
      expect(returns.items[0]).toMatchObject({
        id: a.id,
        refundId: expect.any(String),
      });
      await expect(
        service.adminDepositRecords(adminId, { cursor: '1' }),
      ).rejects.toThrowDomain('INVALID_CURSOR');
    });
  });
});
