import { ClockService } from '@/common/providers/clock.service';
import { LocationAccessLogRepository } from '@/features/region/repositories/location-access-log.repository';
import {
  LOCATION_ACCESS_LOG_RETENTION_DAYS,
  LocationAccessLogService,
} from '@/features/region/services/location-access-log.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount } from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

const NOW = new Date('2026-10-03T19:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = LOCATION_ACCESS_LOG_RETENTION_DAYS * DAY_MS;

describe('LocationAccessLogService (real DB)', () => {
  let service: LocationAccessLogService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        LocationAccessLogService,
        LocationAccessLogRepository,
        { provide: ClockService, useValue: { now: () => NOW } },
      ],
    });
    service = module.get(LocationAccessLogService);
    prisma = p;
  });
  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  describe('record', () => {
    it('로그인 이용은 계정과 목적·시각을 남긴다', async () => {
      const account = await createAccount(prisma);

      await service.record(account.id, 'REGION_BY_LOCATION');

      expect(
        await prisma.locationAccessLog.findMany({
          select: { account_id: true, purpose: true, created_at: true },
        }),
      ).toEqual([
        {
          account_id: account.id,
          purpose: 'REGION_BY_LOCATION',
          created_at: NOW,
        },
      ]);
    });

    it('비로그인 이용은 계정 없이 남긴다', async () => {
      await service.record(null, 'REGION_BY_LOCATION');

      const [row] = await prisma.locationAccessLog.findMany();
      expect(row.account_id).toBeNull();
    });
  });

  describe('purgeExpired', () => {
    it('보존 기간은 법정 최소 6개월(183일)보다 길다', () => {
      expect(LOCATION_ACCESS_LOG_RETENTION_DAYS).toBeGreaterThan(183);
    });

    it.each([
      ['방금 기록', 0, true],
      ['보존 기간 1ms 전', RETENTION_MS - 1, true],
      ['정확히 보존 기간', RETENTION_MS, true],
      ['보존 기간 + 1ms', RETENTION_MS + 1, false],
      ['1년 전', 365 * DAY_MS, false],
    ])('%s 행 → 남김=%s', async (_label, ageMs, kept) => {
      await prisma.locationAccessLog.create({
        data: {
          purpose: 'REGION_BY_LOCATION',
          created_at: new Date(NOW.getTime() - ageMs),
        },
      });

      const deleted = await service.purgeExpired();

      expect(deleted).toBe(kept ? 0 : 1);
      expect(await prisma.locationAccessLog.count()).toBe(kept ? 1 : 0);
    });
  });
});
