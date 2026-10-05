import { SellerPushDeliveryRepository } from '@/features/notification/repositories/seller-push-delivery.repository';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import {
  createSellerPushDelivery,
  createSellerPushDevice,
} from '@/test/factories';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const AT = new Date('2026-10-05T12:00:00.000Z');

describe('SellerPushDeliveryRepository (real DB)', () => {
  let repo: SellerPushDeliveryRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [SellerPushDeliveryRepository],
    });
    repo = module.get(SellerPushDeliveryRepository);
    prisma = p;
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('claim', () => {
    it('디바이스마다 PENDING 행을 만들고 그 행들을 디바이스 id 순으로 돌려준다', async () => {
      const a = await createSellerPushDevice(prisma);
      const b = await createSellerPushDevice(prisma);

      const rows = await repo.claim(EVENT_ID, [b.id, a.id]);

      expect(rows.map((r) => r.push_device_id)).toEqual([a.id, b.id]);
      expect(await prisma.sellerPushDelivery.count()).toBe(2);
      expect(
        await prisma.sellerPushDelivery.findMany({ select: { status: true } }),
      ).toEqual([{ status: 'PENDING' }, { status: 'PENDING' }]);
    });

    it('재전달: ticket이 기록된 디바이스는 빼고 PENDING인 디바이스만 다시 돌려주며 행을 더 만들지 않는다', async () => {
      const done = await createSellerPushDevice(prisma);
      const pending = await createSellerPushDevice(prisma);
      await createSellerPushDelivery(prisma, {
        source_event_id: EVENT_ID,
        push_device_id: done.id,
        status: 'TICKET_OK',
        ticket_id: 't-1',
        sent_at: AT,
      });
      await createSellerPushDelivery(prisma, {
        source_event_id: EVENT_ID,
        push_device_id: pending.id,
      });

      const rows = await repo.claim(EVENT_ID, [done.id, pending.id]);

      expect(rows.map((r) => r.push_device_id)).toEqual([pending.id]);
      expect(await prisma.sellerPushDelivery.count()).toBe(2);
    });

    it('다른 이벤트의 행은 선점에 영향을 주지 않는다', async () => {
      const device = await createSellerPushDevice(prisma);
      await createSellerPushDelivery(prisma, {
        source_event_id: '22222222-2222-4222-8222-222222222222',
        push_device_id: device.id,
        status: 'TICKET_OK',
      });

      const rows = await repo.claim(EVENT_ID, [device.id]);

      expect(rows).toHaveLength(1);
      expect(await prisma.sellerPushDelivery.count()).toBe(2);
    });

    it('반증: 없는 디바이스 id는 FK 오류로 던진다(skipDuplicates였다면 조용히 0건)', async () => {
      await expect(repo.claim(EVENT_ID, [424242n])).rejects.toThrow();
      expect(await prisma.sellerPushDelivery.count()).toBe(0);
    });

    it('디바이스가 없으면 빈 배열', async () => {
      expect(await repo.claim(EVENT_ID, [])).toEqual([]);
    });
  });

  describe('markTickets', () => {
    it('ticket 결과를 행마다 기록한다', async () => {
      const ok = await createSellerPushDelivery(prisma);
      const failed = await createSellerPushDelivery(prisma);

      await repo.markTickets([
        { id: ok.id, status: 'TICKET_OK', ticketId: 't-ok', sentAt: AT },
        {
          id: failed.id,
          status: 'TICKET_ERROR',
          errorCode: 'DeviceNotRegistered',
          sentAt: AT,
        },
      ]);

      expect(
        await prisma.sellerPushDelivery.findUnique({ where: { id: ok.id } }),
      ).toMatchObject({
        status: 'TICKET_OK',
        ticket_id: 't-ok',
        error_code: null,
        sent_at: AT,
      });
      expect(
        await prisma.sellerPushDelivery.findUnique({
          where: { id: failed.id },
        }),
      ).toMatchObject({
        status: 'TICKET_ERROR',
        ticket_id: null,
        error_code: 'DeviceNotRegistered',
        sent_at: AT,
      });
    });
  });

  describe('listForReceipt', () => {
    it('기준 시각 이전에 보낸 미확인 TICKET_OK 행만 오래된 순으로, limit까지', async () => {
      const old = await createSellerPushDelivery(prisma, {
        status: 'TICKET_OK',
        ticket_id: 't-old',
        sent_at: new Date('2026-10-05T11:00:00.000Z'),
      });
      const older = await createSellerPushDelivery(prisma, {
        status: 'TICKET_OK',
        ticket_id: 't-older',
        sent_at: new Date('2026-10-05T10:00:00.000Z'),
      });
      await createSellerPushDelivery(prisma, {
        status: 'TICKET_OK',
        ticket_id: 't-recent',
        sent_at: AT,
      });
      await createSellerPushDelivery(prisma, {
        status: 'TICKET_OK',
        ticket_id: 't-checked',
        sent_at: new Date('2026-10-05T10:00:00.000Z'),
        receipt_checked_at: AT,
      });
      await createSellerPushDelivery(prisma, {
        status: 'TICKET_ERROR',
        error_code: 'MessageTooBig',
        sent_at: new Date('2026-10-05T10:00:00.000Z'),
      });

      const rows = await repo.listForReceipt({ sentBefore: AT, limit: 10 });
      expect(rows.map((r) => r.id)).toEqual([older.id, old.id]);
      expect(rows[0]).toEqual({
        id: older.id,
        push_device_id: older.push_device_id,
        ticket_id: 't-older',
        sent_at: older.sent_at,
      });

      const limited = await repo.listForReceipt({ sentBefore: AT, limit: 1 });
      expect(limited.map((r) => r.id)).toEqual([older.id]);
    });
  });

  describe('markReceipts', () => {
    it('영수증 결과와 확인 시각을 기록하고, 오류가 아니면 error_code를 건드리지 않는다', async () => {
      const ok = await createSellerPushDelivery(prisma, {
        status: 'TICKET_OK',
        ticket_id: 't-1',
      });
      const failed = await createSellerPushDelivery(prisma, {
        status: 'TICKET_OK',
        ticket_id: 't-2',
      });
      const unknown = await createSellerPushDelivery(prisma, {
        status: 'TICKET_OK',
        ticket_id: 't-3',
      });

      await repo.markReceipts(
        [
          { id: ok.id, status: 'RECEIPT_OK' },
          {
            id: failed.id,
            status: 'RECEIPT_ERROR',
            errorCode: 'MessageTooBig',
          },
          { id: unknown.id, status: 'RECEIPT_UNKNOWN' },
        ],
        AT,
      );

      const byId = async (id: bigint) =>
        prisma.sellerPushDelivery.findUnique({ where: { id } });
      expect(await byId(ok.id)).toMatchObject({
        status: 'RECEIPT_OK',
        error_code: null,
        receipt_checked_at: AT,
      });
      expect(await byId(failed.id)).toMatchObject({
        status: 'RECEIPT_ERROR',
        error_code: 'MessageTooBig',
        receipt_checked_at: AT,
      });
      expect(await byId(unknown.id)).toMatchObject({
        status: 'RECEIPT_UNKNOWN',
        error_code: null,
        receipt_checked_at: AT,
      });
    });

    it('빈 결과는 아무것도 하지 않는다', async () => {
      await expect(repo.markReceipts([], AT)).resolves.toBeUndefined();
      await expect(repo.markTickets([])).resolves.toBeUndefined();
    });
  });
});
