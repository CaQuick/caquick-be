import { ClockService } from '@/common/providers/clock.service';
import { IdGenerator } from '@/common/providers/id-generator.service';
import { OutboxRepository } from '@/features/outbox/repositories/outbox.repository';
import { OutboxPublisher } from '@/features/outbox/services/outbox-publisher.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('OutboxRepository (real DB)', () => {
  let repo: OutboxRepository;
  let publisher: OutboxPublisher;
  let prisma: PrismaClient;
  const NOW = new Date('2026-09-24T12:00:00.000Z');

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [OutboxRepository, OutboxPublisher, IdGenerator, ClockService],
    });
    repo = module.get(OutboxRepository);
    publisher = module.get(OutboxPublisher);
    prisma = p;
  });
  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  async function failed(eventType: string): Promise<bigint> {
    const { eventId } = await prisma.$transaction((tx) =>
      publisher.publish(tx, {
        aggregateType: 'test',
        aggregateId: 'A',
        eventType,
        payload: {},
      }),
    );
    const row = await prisma.outbox.findUniqueOrThrow({
      where: { event_id: eventId },
    });
    await prisma.outbox.update({
      where: { id: row.id },
      data: { status: 'FAILED', attempts: 5 },
    });
    return row.id;
  }

  describe('requeueFailed', () => {
    it('FAILED만 PENDING으로 되돌리고 attempts·next_attempt_at을 초기화한다', async () => {
      const id = await failed('test.a');
      const pendingId = (
        await prisma.$transaction((tx) =>
          publisher.publish(tx, {
            aggregateType: 'test',
            aggregateId: 'B',
            eventType: 'test.a',
            payload: {},
          }),
        )
      ).eventId;

      await expect(repo.requeue({}, NOW)).resolves.toBe(1);

      const row = await prisma.outbox.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ status: 'PENDING', attempts: 0 });
      expect(row.next_attempt_at).toEqual(NOW);
      // 원래 PENDING이던 행은 건드리지 않는다
      const untouched = await prisma.outbox.findUniqueOrThrow({
        where: { event_id: pendingId },
      });
      expect(untouched.attempts).toBe(0);
    });

    it('id·eventType 필터로 범위를 좁힌다 — 반증: 다른 타입은 그대로 FAILED', async () => {
      const a = await failed('test.a');
      const b = await failed('test.b');

      await expect(repo.requeue({ eventType: 'test.a' }, NOW)).resolves.toBe(1);
      expect(
        (await prisma.outbox.findUniqueOrThrow({ where: { id: b } })).status,
      ).toBe('FAILED');

      await expect(repo.requeue({ id: b }, NOW)).resolves.toBe(1);
      expect(
        (await prisma.outbox.findUniqueOrThrow({ where: { id: a } })).status,
      ).toBe('PENDING');
      await expect(repo.requeue({}, NOW)).resolves.toBe(0);
    });

    // 소비 DLQ 재처리 — 행은 이미 PUBLISHED라 FAILED 필터로는 못 살린다
    it('republish는 event_id 1건의 PUBLISHED 행도 PENDING으로 되돌린다 — 반증: event_id 없이는 거절', async () => {
      const id = await failed('test.a');
      await prisma.outbox.update({
        where: { id },
        data: { status: 'PUBLISHED', attempts: 3 },
      });
      const { event_id } = await prisma.outbox.findUniqueOrThrow({
        where: { id },
      });

      await expect(repo.requeue({ eventId: event_id }, NOW)).resolves.toBe(0); // 기본은 FAILED만
      await expect(
        repo.requeue({ eventId: event_id }, NOW, { republish: true }),
      ).resolves.toBe(1);
      expect(
        await prisma.outbox.findUniqueOrThrow({ where: { id } }),
      ).toMatchObject({ status: 'PENDING', attempts: 0 });

      await expect(
        repo.requeue({ eventType: 'test.a' }, NOW, { republish: true }),
      ).rejects.toThrow('--event-id');
      // 반증: 같은 타입의 다른 PUBLISHED 행은 건드리지 않는다 — 소비자 멱등에 기대는 재발행은 1건씩만
      const other = await failed('test.a');
      await prisma.outbox.update({
        where: { id: other },
        data: { status: 'PUBLISHED' },
      });
      await expect(
        repo.requeue({ eventId: event_id }, NOW, { republish: true }),
      ).resolves.toBe(0); // 이미 PENDING이라 0
      expect(
        (await prisma.outbox.findUniqueOrThrow({ where: { id: other } }))
          .status,
      ).toBe('PUBLISHED');
    });
  });

  describe('메트릭 집계', () => {
    it('countByStatus는 없는 상태를 0으로, oldestDuePendingOccurredAt은 기한이 된 PENDING 중 가장 오래된 것을 돌려준다', async () => {
      await expect(repo.countByStatus()).resolves.toEqual({
        PENDING: 0,
        PUBLISHED: 0,
        FAILED: 0,
      });
      await expect(repo.oldestDuePendingOccurredAt(NOW)).resolves.toBeNull();

      await failed('test.a');
      for (const [aggregateId, occurredAt] of [
        ['B', '2026-09-24T10:00:00.000Z'],
        ['C', '2026-09-24T11:00:00.000Z'],
      ]) {
        await prisma.$transaction((tx) =>
          publisher.publish(tx, {
            aggregateType: 'test',
            aggregateId,
            eventType: 'test.a',
            payload: {},
            occurredAt: new Date(occurredAt),
          }),
        );
      }

      await expect(repo.countByStatus()).resolves.toEqual({
        PENDING: 2,
        PUBLISHED: 0,
        FAILED: 1,
      });
      await expect(repo.oldestDuePendingOccurredAt(NOW)).resolves.toEqual(
        new Date('2026-09-24T10:00:00.000Z'),
      );
      // 반증: 백오프 대기(next_attempt_at 미래) 행은 릴레이 지연이 아니다 — 세지 않는다
      await prisma.outbox.updateMany({
        where: { aggregate_id: 'B' },
        data: { next_attempt_at: new Date(NOW.getTime() + 60_000) },
      });
      await expect(repo.oldestDuePendingOccurredAt(NOW)).resolves.toEqual(
        new Date('2026-09-24T11:00:00.000Z'),
      );
    });
  });
});
