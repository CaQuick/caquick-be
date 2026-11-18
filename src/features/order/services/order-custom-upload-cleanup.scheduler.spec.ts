import { Logger } from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import { HOUR_MS } from '@/common/utils/kst-time';
import { OrderCustomUploadRepository } from '@/features/order/repositories/order-custom-upload.repository';
import {
  OrderCustomUploadCleanupScheduler,
  PURGE_BATCH_LIMIT,
} from '@/features/order/services/order-custom-upload-cleanup.scheduler';
import type {
  OrderCustomUploadStatus,
  PrismaClient,
} from '@/generated/prisma/client';
import { AlertService } from '@/global/alerting';
import {
  S3Service,
  type DeleteObjectsFailure,
} from '@/global/storage/s3.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount, createOrderCustomUpload } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

const NOW = new Date('2026-11-19T11:20:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

// 정리 대상 판정(오래된 PENDING·멈춘 PURGING, ATTACHED는 제외)·S3 삭제·기록 삭제·실패 시 PURGING 유지와 경보. S3는 외부라 stub이다.
describe('OrderCustomUploadCleanupScheduler (real DB)', () => {
  let scheduler: OrderCustomUploadCleanupScheduler;
  let repository: OrderCustomUploadRepository;
  let prisma: PrismaClient;
  let accountId: bigint;
  let now = NOW;
  const deleteObjects = jest.fn<
    Promise<DeleteObjectsFailure[]>,
    [readonly string[]]
  >();
  const alerts = { notify: jest.fn().mockResolvedValue('sent') };
  const savedRole = process.env.APP_ROLE;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        OrderCustomUploadCleanupScheduler,
        OrderCustomUploadRepository,
        { provide: ClockService, useValue: { now: () => now } },
        { provide: S3Service, useValue: { deleteObjects } },
        { provide: AlertService, useValue: alerts },
      ],
    });
    scheduler = module.get(OrderCustomUploadCleanupScheduler);
    repository = module.get(OrderCustomUploadRepository);
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
    now = NOW;
    deleteObjects.mockReset();
    deleteObjects.mockResolvedValue([]);
    alerts.notify.mockClear();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    accountId = (await createAccount(prisma, { account_type: 'USER' })).id;
  });
  afterEach(() => jest.restoreAllMocks());

  async function upload(
    key: string,
    status: OrderCustomUploadStatus,
    at: { createdAgo?: number; purgeStartedAgo?: number } = {},
  ) {
    return createOrderCustomUpload(prisma, {
      account_id: accountId,
      object_key: key,
      status,
      created_at: ago(at.createdAgo ?? 0),
      purge_started_at:
        at.purgeStartedAgo === undefined ? null : ago(at.purgeStartedAgo),
    });
  }

  const statusOf = async () =>
    Object.fromEntries(
      (await prisma.orderCustomUpload.findMany()).map((u) => [
        u.object_key,
        u.status,
      ]),
    );

  it('하루 지난 PENDING과 한 시간 지난 PURGING만 S3에서 지우고 기록도 지운다', async () => {
    await upload('pending-24h', 'PENDING', { createdAgo: 24 * HOUR_MS });
    await upload('pending-23h59', 'PENDING', { createdAgo: 24 * HOUR_MS - 1 });
    await upload('purging-1h', 'PURGING', {
      createdAgo: 30 * HOUR_MS,
      purgeStartedAgo: HOUR_MS,
    });
    await upload('purging-59m', 'PURGING', {
      createdAgo: 30 * HOUR_MS,
      purgeStartedAgo: HOUR_MS - 1,
    });
    // 주문에 쓰인 파일은 오래돼도 보관한다
    await upload('attached-old', 'ATTACHED', { createdAgo: 72 * HOUR_MS });

    await scheduler.purgeUnusedUploads();

    expect(deleteObjects).toHaveBeenCalledTimes(1);
    expect([...deleteObjects.mock.calls[0][0]].sort()).toEqual([
      'pending-24h',
      'purging-1h',
    ]);
    expect(await statusOf()).toEqual({
      'pending-23h59': 'PENDING',
      'purging-59m': 'PURGING',
      'attached-old': 'ATTACHED',
    });
    expect(alerts.notify).not.toHaveBeenCalled();
  });

  it('S3 삭제에 실패한 키는 PURGING으로 남기고 경보하며, 한 시간 뒤 정리에서 다시 지운다', async () => {
    await upload('ok', 'PENDING', { createdAgo: 25 * HOUR_MS });
    await upload('denied', 'PENDING', { createdAgo: 25 * HOUR_MS });
    deleteObjects.mockResolvedValueOnce([
      { key: 'denied', code: 'AccessDenied' },
    ]);

    await scheduler.purgeUnusedUploads();

    const left = await prisma.orderCustomUpload.findMany();
    expect(left).toEqual([
      expect.objectContaining({
        object_key: 'denied',
        status: 'PURGING',
        purge_started_at: NOW,
      }),
    ]);
    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        key: 'order-custom-upload:purge',
        detail: expect.stringContaining('1/2건 실패(AccessDenied)'),
      }),
    );

    now = new Date(NOW.getTime() + HOUR_MS - 1);
    await scheduler.purgeUnusedUploads();
    expect(deleteObjects).toHaveBeenCalledTimes(1);

    now = new Date(NOW.getTime() + HOUR_MS);
    await scheduler.purgeUnusedUploads();
    expect(deleteObjects).toHaveBeenLastCalledWith(['denied']);
    expect(await prisma.orderCustomUpload.count()).toBe(0);
  });

  it('묶음 상한을 넘으면 다음 묶음을 이어 잡고, 실패한 묶음 뒤에는 더 잡지 않는다', async () => {
    const createdAt = ago(25 * HOUR_MS);
    await prisma.orderCustomUpload.createMany({
      data: Array.from({ length: PURGE_BATCH_LIMIT + 1 }, (_, i) => ({
        account_id: accountId,
        purpose: 'RENDER' as const,
        object_key: `k${i}`,
        content_type: 'image/png',
        content_length: 1,
        created_at: createdAt,
      })),
    });
    deleteObjects.mockImplementationOnce((keys) =>
      Promise.resolve(keys.map((key) => ({ key, code: 'InternalError' }))),
    );

    await scheduler.purgeUnusedUploads();
    expect(deleteObjects).toHaveBeenCalledTimes(1);
    expect(deleteObjects.mock.calls[0][0]).toHaveLength(PURGE_BATCH_LIMIT);
    expect(
      await prisma.orderCustomUpload.count({ where: { status: 'PENDING' } }),
    ).toBe(1);

    now = new Date(NOW.getTime() + HOUR_MS);
    await scheduler.purgeUnusedUploads();
    expect(deleteObjects.mock.calls.slice(1).map((c) => c[0].length)).toEqual([
      PURGE_BATCH_LIMIT,
      1,
    ]);
    expect(await prisma.orderCustomUpload.count()).toBe(0);
  });

  it('주문 tx가 잡고 있는 업로드는 건너뛴다', async () => {
    const held = await upload('held', 'PENDING', { createdAgo: 25 * HOUR_MS });
    await upload('free', 'PENDING', { createdAgo: 25 * HOUR_MS });

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM order_custom_upload WHERE id = ${held.id} FOR UPDATE`;
      await scheduler.purgeUnusedUploads();
    });

    expect(deleteObjects).toHaveBeenCalledWith(['free']);
    expect(await statusOf()).toEqual({ held: 'PENDING' });
  });

  it('api 역할에서는 아무것도 하지 않는다', async () => {
    process.env.APP_ROLE = 'api';
    await upload('old', 'PENDING', { createdAgo: 25 * HOUR_MS });

    await scheduler.purgeUnusedUploads();

    expect(deleteObjects).not.toHaveBeenCalled();
    expect(await statusOf()).toEqual({ old: 'PENDING' });
  });

  it('앞 틱이 도는 중이면 겹친 틱은 건너뛴다', async () => {
    await upload('old', 'PENDING', { createdAgo: 25 * HOUR_MS });
    let release!: () => void;
    deleteObjects.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([]))),
    );

    const first = scheduler.purgeUnusedUploads();
    while (deleteObjects.mock.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await scheduler.purgeUnusedUploads();
    release();
    await first;

    expect(deleteObjects).toHaveBeenCalledTimes(1);
    expect(await prisma.orderCustomUpload.count()).toBe(0);
  });

  it('기록을 읽다 실패하면 경보하고 던지지 않는다', async () => {
    jest
      .spyOn(repository, 'claimForPurge')
      .mockRejectedValueOnce(new Error('db down'));

    await expect(scheduler.purgeUnusedUploads()).resolves.toBeUndefined();

    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        key: 'order-custom-upload:purge',
        detail: 'db down',
      }),
    );
    // 실패 뒤에도 다음 틱은 돈다
    await upload('old', 'PENDING', { createdAgo: 25 * HOUR_MS });
    await scheduler.purgeUnusedUploads();
    expect(deleteObjects).toHaveBeenCalledWith(['old']);
  });
});
