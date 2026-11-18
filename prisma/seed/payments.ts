/**
 * 결제 설정·결제·환불·입금 기록·정산 계좌 시드. seedOrders의 o7~o11에 붙이고, 처리자는 시드 관리자다.
 *   o7  입금 대기(PENDING, 1시간 기한)
 *   o8·o11 관리자 입금 확인(CONFIRMED)
 *   o9  확인된 결제 + 부분 환불 요청(계좌 입력 대기)
 *   o10 미입금 취소(CANCELED) + 늦은 입금을 반환 대상으로 연결
 * 결제 설정은 resetSeedScope가 지우지 않는 단일 행이라 upsert한다.
 * seed-seller-a 매장 정산 계좌는 앱과 같은 키 설정(ACCOUNT_ENCRYPTION_KEYS, 없으면 개발 키)으로 암호화한다.
 */
import type { SeededOrders } from './orders';
import type { SeededStores } from './stores';

import { readAccountCryptoConfig } from '@/config/account-crypto.config';
import type { Payment, PrismaClient } from '@/generated/prisma/client';
import { AccountCipher } from '@/global/crypto/account-cipher.service';

const DEPOSIT_ACCOUNT = {
  deposit_bank_code: '004',
  deposit_account_number: '00000000000000',
  deposit_account_holder: '케이퀵(테스트)',
} as const;

const PAYMENT_WINDOW_MS = 60 * 60 * 1000;

export const SEED_SETTLEMENT_ACCOUNT = {
  bank_code: '088',
  account_holder: '케이크샵 A',
  account_number: '110123456789',
} as const;

export async function seedPayments(
  prisma: PrismaClient,
  ctx: {
    orders: SeededOrders;
    stores: SeededStores;
    admin: { id: bigint; label: string | null };
  },
): Promise<void> {
  await prisma.paymentSetting.upsert({
    where: { id: 1 },
    create: { id: 1, ...DEPOSIT_ACCOUNT },
    update: DEPOSIT_ACCOUNT,
  });

  const orderOf = (id: bigint) =>
    prisma.order.findUniqueOrThrow({ where: { id } });
  const createPayment = async (
    orderId: bigint,
    status: Payment['status'],
  ): Promise<void> => {
    const order = await orderOf(orderId);
    await prisma.payment.create({
      data: {
        order_id: order.id,
        method: 'BANK_TRANSFER',
        status,
        amount: order.total_price,
        depositor_name: order.buyer_name,
        ...DEPOSIT_ACCOUNT,
        expires_at: new Date(order.created_at.getTime() + PAYMENT_WINDOW_MS),
        ...(status === 'CONFIRMED'
          ? {
              confirmed_at: order.submitted_at,
              confirm_source: 'ADMIN',
              confirmed_by_account_id: ctx.admin.id,
              confirmed_by_label_snapshot: ctx.admin.label,
            }
          : {}),
        ...(status === 'CANCELED' ? { canceled_at: order.canceled_at } : {}),
      },
    });
  };

  const { orders } = ctx;
  await createPayment(orders.o7PendingPayment, 'PENDING');
  await createPayment(orders.o8NoShow, 'CONFIRMED');
  await createPayment(orders.o9PartialRefund, 'CONFIRMED');
  await createPayment(orders.o10UnpaidCanceled, 'CANCELED');
  await createPayment(orders.o11PaidSubmitted, 'CONFIRMED');

  const o9 = await orderOf(orders.o9PartialRefund);
  const o9Cancel = await prisma.orderStatusHistory.findFirstOrThrow({
    where: { order_id: o9.id, to_status: 'CANCELED' },
  });
  await prisma.refund.create({
    data: {
      order_id: o9.id,
      kind: 'CANCEL',
      cancel_order_id: o9.id,
      amount: o9Cancel.refund_amount ?? 0,
      requested_at: o9Cancel.changed_at,
    },
  });

  const o10 = await orderOf(orders.o10UnpaidCanceled);
  const lateDepositAt = new Date(
    (o10.canceled_at ?? o10.created_at).getTime() + 2 * PAYMENT_WINDOW_MS,
  );
  const depositRecord = await prisma.depositRecord.create({
    data: {
      kind: 'RETURN',
      order_id: o10.id,
      amount: o10.total_price,
      depositor_name: o10.buyer_name,
      deposited_at: lateDepositAt,
      note: '미입금 자동 취소 뒤 들어온 입금',
      recorded_by_account_id: ctx.admin.id,
      recorded_by_label_snapshot: ctx.admin.label,
    },
  });
  await prisma.refund.create({
    data: {
      order_id: o10.id,
      kind: 'DEPOSIT_RETURN',
      deposit_record_id: depositRecord.id,
      amount: depositRecord.amount,
      requested_at: lateDepositAt,
    },
  });

  const [storeA] = ctx.stores.stores;
  const cipher = new AccountCipher(readAccountCryptoConfig());
  await prisma.storeSettlementAccount.create({
    data: {
      store_id: storeA.id,
      bank_code: SEED_SETTLEMENT_ACCOUNT.bank_code,
      account_holder: SEED_SETTLEMENT_ACCOUNT.account_holder,
      account_number_enc: cipher.encrypt(
        SEED_SETTLEMENT_ACCOUNT.account_number,
        'settlement-account',
      ),
      account_number_last4: SEED_SETTLEMENT_ACCOUNT.account_number.slice(-4),
      updated_by_account_id: storeA.seller_account_id,
      updated_by_role: 'SELLER',
    },
  });
}
