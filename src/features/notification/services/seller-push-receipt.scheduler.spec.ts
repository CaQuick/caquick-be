import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ClockService } from '@/common/providers/clock.service';
import type { ExpoPushConfig } from '@/config/expo-push.config';
import { SellerPushDeliveryRepository } from '@/features/notification/repositories/seller-push-delivery.repository';
import { SellerPushDeviceRepository } from '@/features/notification/repositories/seller-push-device.repository';
import { SellerPushReceiptScheduler } from '@/features/notification/services/seller-push-receipt.scheduler';
import type { PrismaClient } from '@/generated/prisma/client';
import { AlertService } from '@/global/alerting';
import {
  EXPO_PUSH_TRANSPORT,
  ExpoPushAuthError,
  type ExpoPushReceipt,
  type ExpoPushTransport,
} from '@/global/expo-push';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createSellerPushDelivery,
  createSellerPushDevice,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

const NOW = new Date('2026-10-05T12:00:00.000Z');
const MINUTE = 60 * 1000;
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * MINUTE);

// 영수증 조회 — 15분 지난 TICKET_OK만, 오류면 디바이스 비활성, 24h 넘게 영수증이 없으면 UNKNOWN으로 닫는다. 실패는 경보만.
describe('SellerPushReceiptScheduler (real DB)', () => {
  let scheduler: SellerPushReceiptScheduler;
  let deliveryRepository: SellerPushDeliveryRepository;
  let prisma: PrismaClient;
  let cfg: ExpoPushConfig;
  const getReceipts = jest.fn<
    Promise<Record<string, ExpoPushReceipt>>,
    Parameters<ExpoPushTransport['getReceipts']>
  >();
  const transport: ExpoPushTransport = { send: jest.fn(), getReceipts };
  const alerts = { notify: jest.fn().mockResolvedValue('sent') };
  const savedRole = process.env.APP_ROLE;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        SellerPushReceiptScheduler,
        SellerPushDeliveryRepository,
        SellerPushDeviceRepository,
        { provide: ClockService, useValue: { now: () => NOW } },
        { provide: ConfigService, useValue: { getOrThrow: () => cfg } },
        { provide: AlertService, useValue: alerts },
        { provide: EXPO_PUSH_TRANSPORT, useValue: transport },
      ],
    });
    scheduler = module.get(SellerPushReceiptScheduler);
    deliveryRepository = module.get(SellerPushDeliveryRepository);
    prisma = p;
  });
  afterAll(async () => {
    if (savedRole === undefined) delete process.env.APP_ROLE;
    else process.env.APP_ROLE = savedRole;
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  beforeEach(async () => {
    await truncateAll();
    process.env.APP_ROLE = 'worker';
    cfg = { enabled: true, accessToken: 'tok', requestTimeoutMs: 1_000 };
    getReceipts.mockReset();
    getReceipts.mockResolvedValue({});
    alerts.notify.mockClear();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  async function ticketOk(ticketId: string, sentMinutesAgo: number) {
    const device = await createSellerPushDevice(prisma);
    const delivery = await createSellerPushDelivery(prisma, {
      push_device_id: device.id,
      status: 'TICKET_OK',
      ticket_id: ticketId,
      sent_at: minutesAgo(sentMinutesAgo),
    });
    return { device, delivery };
  }
  const deliveryOf = (id: bigint) =>
    prisma.sellerPushDelivery.findUniqueOrThrow({ where: { id } });
  const deviceOf = (id: bigint) =>
    prisma.sellerPushDevice.findUniqueOrThrow({ where: { id } });

  it('15분이 지난 TICKET_OK만 조회하고 ok 영수증은 RECEIPT_OK로 닫는다 — 반증: 15분 미만은 조회하지 않는다', async () => {
    const { delivery: due } = await ticketOk('t-due', 16);
    const { delivery: fresh } = await ticketOk('t-fresh', 14);
    getReceipts.mockResolvedValue({ 't-due': { status: 'ok' } });

    await scheduler.checkReceipts();

    expect(getReceipts).toHaveBeenCalledTimes(1);
    expect(getReceipts).toHaveBeenCalledWith(['t-due'], {
      accessToken: 'tok',
      timeoutMs: 1_000,
    });
    expect(await deliveryOf(due.id)).toMatchObject({
      status: 'RECEIPT_OK',
      receipt_checked_at: NOW,
    });
    expect(await deliveryOf(fresh.id)).toMatchObject({
      status: 'TICKET_OK',
      receipt_checked_at: null,
    });
  });

  it('대상이 없으면 Expo를 부르지 않는다', async () => {
    await ticketOk('t-fresh', 1);

    await scheduler.checkReceipts();

    expect(getReceipts).not.toHaveBeenCalled();
  });

  it('DeviceNotRegistered 영수증은 RECEIPT_ERROR로 남기고 디바이스를 비활성한다 — 다른 오류는 디바이스를 살려 둔다', async () => {
    const gone = await ticketOk('t-gone', 20);
    const big = await ticketOk('t-big', 20);
    getReceipts.mockResolvedValue({
      't-gone': {
        status: 'error',
        message: 'x',
        details: { error: 'DeviceNotRegistered' },
      },
      't-big': {
        status: 'error',
        message: 'y',
        details: { error: 'MessageTooBig' },
      },
    });

    await scheduler.checkReceipts();

    expect(await deliveryOf(gone.delivery.id)).toMatchObject({
      status: 'RECEIPT_ERROR',
      error_code: 'DeviceNotRegistered',
      receipt_checked_at: NOW,
    });
    expect(await deviceOf(gone.device.id)).toMatchObject({
      disabled_at: NOW,
      disabled_reason: 'DEVICE_NOT_REGISTERED',
    });
    expect(await deliveryOf(big.delivery.id)).toMatchObject({
      status: 'RECEIPT_ERROR',
      error_code: 'MessageTooBig',
    });
    expect((await deviceOf(big.device.id)).disabled_at).toBeNull();
  });

  it('영수증 기록(markReceipts)이 던져도 DeviceNotRegistered 디바이스는 이미 비활성이고 행은 다음 틱에 다시 본다', async () => {
    const gone = await ticketOk('t-gone', 20);
    getReceipts.mockResolvedValue({
      't-gone': {
        status: 'error',
        message: 'x',
        details: { error: 'DeviceNotRegistered' },
      },
    });
    jest
      .spyOn(deliveryRepository, 'markReceipts')
      .mockRejectedValueOnce(new Error('db down'));

    await scheduler.checkReceipts();

    expect(await deviceOf(gone.device.id)).toMatchObject({
      disabled_at: NOW,
      disabled_reason: 'DEVICE_NOT_REGISTERED',
    });
    expect(await deliveryOf(gone.delivery.id)).toMatchObject({
      status: 'TICKET_OK',
      receipt_checked_at: null,
    });
    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'expo-push:receipts', detail: 'db down' }),
    );
  });

  it('영수증이 없는 ticket은 24시간이 지나면 RECEIPT_UNKNOWN으로 닫고, 그 전에는 다음 틱에 다시 본다', async () => {
    const { delivery: expired } = await ticketOk('t-expired', 24 * 60);
    const { delivery: waiting } = await ticketOk('t-waiting', 24 * 60 - 1);

    await scheduler.checkReceipts();

    expect(getReceipts).toHaveBeenCalledWith(
      ['t-expired', 't-waiting'],
      expect.anything(),
    );
    expect(await deliveryOf(expired.id)).toMatchObject({
      status: 'RECEIPT_UNKNOWN',
      error_code: null,
      receipt_checked_at: NOW,
    });
    expect(await deliveryOf(waiting.id)).toMatchObject({
      status: 'TICKET_OK',
      receipt_checked_at: null,
    });

    await scheduler.checkReceipts();
    expect(getReceipts).toHaveBeenLastCalledWith(
      ['t-waiting'],
      expect.anything(),
    );
  });

  it('조회가 던지면 삼키고 warn 경보를 내며 행은 그대로다', async () => {
    const { delivery } = await ticketOk('t-1', 20);
    getReceipts.mockRejectedValue(new Error('fetch failed'));

    await expect(scheduler.checkReceipts()).resolves.toBeUndefined();

    expect(alerts.notify).toHaveBeenCalledWith({
      level: 'warn',
      title: 'Expo 푸시 영수증 조회 실패',
      key: 'expo-push:receipts',
      detail: 'fetch failed',
    });
    expect(Logger.prototype.warn).toHaveBeenCalled();
    expect(await deliveryOf(delivery.id)).toMatchObject({
      status: 'TICKET_OK',
      receipt_checked_at: null,
    });
  });

  it('401은 인증 실패 경보(error)로 낸다', async () => {
    await ticketOk('t-1', 20);
    getReceipts.mockRejectedValue(
      new ExpoPushAuthError(401, 'Expo 푸시 영수증 조회'),
    );

    await scheduler.checkReceipts();

    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        title: 'Expo 푸시 인증 실패',
        key: 'expo-push:auth',
      }),
    );
  });

  it.each(['api', 'ws'] as const)(
    '반증: %s 역할에서는 돌지 않는다',
    async (role) => {
      process.env.APP_ROLE = role;
      await ticketOk('t-1', 20);

      await scheduler.checkReceipts();

      expect(getReceipts).not.toHaveBeenCalled();
    },
  );

  it('EXPO_PUSH_ENABLED=false면 돌지 않는다', async () => {
    cfg = { ...cfg, enabled: false };
    await ticketOk('t-1', 20);

    await scheduler.checkReceipts();

    expect(getReceipts).not.toHaveBeenCalled();
  });

  it('반증: 앞선 틱이 끝나기 전의 틱은 건너뛰고, 끝난 뒤에는 다시 돈다', async () => {
    await ticketOk('t-1', 20);
    let finish!: (value: Record<string, ExpoPushReceipt>) => void;
    getReceipts.mockReturnValueOnce(
      new Promise<Record<string, ExpoPushReceipt>>((resolve) => {
        finish = resolve;
      }),
    );

    const first = scheduler.checkReceipts();
    // 첫 틱이 DB 조회를 지나 Expo 호출에 머무를 때까지
    while (getReceipts.mock.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await scheduler.checkReceipts();
    expect(getReceipts).toHaveBeenCalledTimes(1);

    finish({ 't-1': { status: 'ok' } });
    await first;
    await ticketOk('t-2', 20);
    await scheduler.checkReceipts();

    expect(getReceipts).toHaveBeenCalledTimes(2);
    expect(getReceipts).toHaveBeenLastCalledWith(['t-2'], expect.anything());
  });
});
