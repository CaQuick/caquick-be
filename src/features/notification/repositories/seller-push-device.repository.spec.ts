import { SellerPushDeviceRepository } from '@/features/notification/repositories/seller-push-device.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createSellerPushDelivery,
  createSellerPushDevice,
  setupSellerWithStore,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

const AT = new Date('2026-10-05T12:00:00.000Z');

describe('SellerPushDeviceRepository (real DB)', () => {
  let repo: SellerPushDeviceRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [SellerPushDeviceRepository],
    });
    repo = module.get(SellerPushDeviceRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('listActiveByStore', () => {
    it('해당 매장의 활성 디바이스만 id 순으로 돌려준다', async () => {
      const seller = await setupSellerWithStore(prisma);
      const base = { account_id: seller.account.id, store_id: seller.store.id };
      const first = await createSellerPushDevice(prisma, base);
      await createSellerPushDevice(prisma, { ...base, disabled_at: AT });
      const second = await createSellerPushDevice(prisma, base);
      await createSellerPushDevice(prisma);

      const rows = await repo.listActiveByStore(seller.store.id);

      expect(rows.map((r) => r.id)).toEqual([first.id, second.id]);
      expect(rows[0]).toEqual({
        id: first.id,
        expo_push_token: first.expo_push_token,
        platform: 'IOS',
      });
    });

    it('디바이스가 없는 매장은 빈 배열', async () => {
      expect(await repo.listActiveByStore(424242n)).toEqual([]);
    });
  });

  describe('disableByIds', () => {
    it('지정한 활성 행만 사유와 함께 비활성하고 건수를 돌려준다', async () => {
      const target = await createSellerPushDevice(prisma);
      const untouched = await createSellerPushDevice(prisma);

      const count = await repo.disableByIds(
        [target.id],
        'DEVICE_NOT_REGISTERED',
        AT,
      );

      expect(count).toBe(1);
      const rows = await prisma.sellerPushDevice.findMany({
        orderBy: { id: 'asc' },
      });
      expect(rows[0]).toMatchObject({
        id: target.id,
        disabled_at: AT,
        disabled_reason: 'DEVICE_NOT_REGISTERED',
      });
      expect(rows[1]).toMatchObject({ id: untouched.id, disabled_at: null });
    });

    it('이미 해제된 행은 사유·시각을 덮지 않는다', async () => {
      const earlier = new Date('2026-10-01T00:00:00.000Z');
      const device = await createSellerPushDevice(prisma, {
        disabled_at: earlier,
        disabled_reason: 'UNREGISTERED',
      });

      expect(
        await repo.disableByIds([device.id], 'DEVICE_NOT_REGISTERED', AT),
      ).toBe(0);

      const row = await prisma.sellerPushDevice.findUniqueOrThrow({
        where: { id: device.id },
      });
      expect(row.disabled_at).toEqual(earlier);
      expect(row.disabled_reason).toBe('UNREGISTERED');
    });

    it('빈 배열은 쿼리 없이 0', async () => {
      expect(await repo.disableByIds([], 'DEVICE_NOT_REGISTERED', AT)).toBe(0);
    });
  });

  describe('SellerPushDelivery 제약', () => {
    it('같은 이벤트·디바이스 조합은 한 행만 허용한다', async () => {
      const delivery = await createSellerPushDelivery(prisma);
      await expect(
        createSellerPushDelivery(prisma, {
          source_event_id: delivery.source_event_id,
          push_device_id: delivery.push_device_id,
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('없는 디바이스를 가리키는 전달 행은 FK로 거부된다', async () => {
      await expect(
        createSellerPushDelivery(prisma, { push_device_id: 999999n }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });
  });
});
