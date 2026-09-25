import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';

import { ClockService } from '@/common/providers/clock.service';
import { IdGenerator } from '@/common/providers/id-generator.service';
import type { OutboxConfig } from '@/config/outbox.config';
import { SubscribeOutbox } from '@/features/outbox/decorators/subscribe-outbox.decorator';
import { OutboxRepository } from '@/features/outbox/repositories/outbox.repository';
import { OutboxDispatcherService } from '@/features/outbox/services/outbox-dispatcher.service';
import { OutboxPublisher } from '@/features/outbox/services/outbox-publisher.service';
import type {
  OutboxConsumer,
  OutboxEvent,
} from '@/features/outbox/types/outbox-event.type';
import type { PrismaClient } from '@/generated/prisma/client';
import { AlertService } from '@/global/alerting';
import { requestContextStorage } from '@/global/request-context/request-context.service';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';
import { drainOutbox } from '@/test/outbox';

const START = new Date('2026-09-19T12:00:00.000Z');

/** 전달 기록 + 이벤트별 남은 실패 횟수. 실패도 "처리 뒤 throw"라 at-least-once가 그대로 드러난다. */
@Injectable()
@SubscribeOutbox('test.a', 'test.b')
class RecordingConsumer implements OutboxConsumer {
  calls: string[] = [];
  failuresLeft = new Map<string, number>();
  block: Promise<void> | null = null;

  async handle(event: OutboxEvent): Promise<void> {
    if (this.block) await this.block;
    const label = `${event.aggregateId}:${(event.payload as { n: number }).n}`;
    this.calls.push(label);
    const left = this.failuresLeft.get(label) ?? 0;
    if (left > 0) {
      this.failuresLeft.set(label, left - 1);
      throw new Error(`consumer failure ${label}`);
    }
  }
}

/** 소비 중 요청 컨텍스트(ALS)의 eventId — 로거 포맷이 모든 줄에 싣는 조인 키(P2 E8) */
@Injectable()
@SubscribeOutbox('test.ctx')
class ContextRecordingConsumer implements OutboxConsumer {
  seen: Array<string | undefined> = [];

  handle(): Promise<void> {
    this.seen.push(requestContextStorage.getStore()?.eventId);
    return Promise.resolve();
  }
}

describe('OutboxDispatcherService (real DB)', () => {
  let dispatcher: OutboxDispatcherService;
  let publisher: OutboxPublisher;
  let consumer: RecordingConsumer;
  let ctxConsumer: ContextRecordingConsumer;
  let prisma: PrismaClient;
  const alerts = { notify: jest.fn().mockResolvedValue('sent') };
  let now = START;
  const cfg: OutboxConfig = {
    dispatchEnabled: true,
    pollIntervalMs: 1_000,
    batchSize: 100,
    maxAttempts: 5,
    partitionConcurrency: 4,
  };

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      imports: [DiscoveryModule],
      providers: [
        OutboxDispatcherService,
        OutboxPublisher,
        OutboxRepository,
        RecordingConsumer,
        ContextRecordingConsumer,
        IdGenerator,
        { provide: AlertService, useValue: alerts },
        { provide: ClockService, useValue: { now: () => now } },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => (key === 'outbox' ? cfg : undefined),
          },
        },
      ],
    });
    dispatcher = module.get(OutboxDispatcherService);
    publisher = module.get(OutboxPublisher);
    consumer = module.get(RecordingConsumer);
    ctxConsumer = module.get(ContextRecordingConsumer);
    prisma = p;
  });
  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
    jest.restoreAllMocks();
  });
  beforeEach(async () => {
    await truncateAll();
    now = START;
    consumer.calls = [];
    consumer.failuresLeft.clear();
    consumer.block = null;
    alerts.notify.mockClear();
    Object.assign(cfg, { batchSize: 100, maxAttempts: 5 });
  });

  async function enqueue(aggregateId: string, n: number, eventType = 'test.a') {
    return prisma.$transaction((tx) =>
      publisher.publish(tx, {
        aggregateType: 'test',
        aggregateId,
        eventType,
        payload: { n },
      }),
    );
  }
  async function statusOf(aggregateId: string, n: number) {
    const row = await prisma.outbox.findFirstOrThrow({
      where: { aggregate_id: aggregateId, payload_json: { equals: { n } } },
    });
    return {
      status: row.status,
      attempts: row.attempts,
      next: row.next_attempt_at,
    };
  }

  describe('요청 컨텍스트(E8 조인 키)', () => {
    it('소비자 handle은 ALS eventId 안에서 돌고, 성공 시 eventId를 실은 소비 로그 1줄을 남긴다', async () => {
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const { eventId } = await enqueue('C', 1, 'test.ctx');

      await drainOutbox(dispatcher);

      expect(ctxConsumer.seen).toEqual([eventId]);
      expect(log).toHaveBeenCalledWith('outbox 소비', {
        eventId,
        eventType: 'test.ctx',
        consumers: 1,
      });
      log.mockRestore();
    });
  });

  describe('경보', () => {
    it('maxAttempts를 채워 FAILED가 되면 event_type 키로 경보를 1건 보낸다(재시도 단계에서는 보내지 않는다)', async () => {
      Object.assign(cfg, { maxAttempts: 2 });
      await enqueue('A', 1);
      consumer.failuresLeft.set('A:1', 5);

      await drainOutbox(dispatcher);
      expect(alerts.notify).not.toHaveBeenCalled();
      now = new Date(now.getTime() + 60_000);
      await drainOutbox(dispatcher);

      expect((await statusOf('A', 1)).status).toBe('FAILED');
      expect(alerts.notify).toHaveBeenCalledTimes(1);
      expect(alerts.notify).toHaveBeenCalledWith({
        level: 'error',
        title: 'outbox FAILED',
        key: 'outbox-failed:test.a',
        detail: expect.stringMatching(/^test\.a#.+ 2회 실패$/) as string,
      });
    });
  });

  describe('dispatchOnce', () => {
    it('파티션 안은 id 순으로, 파티션 간은 서로 섞여도 전부 전달하고 PUBLISHED로 남긴다', async () => {
      await enqueue('A', 1);
      await enqueue('B', 1);
      await enqueue('A', 2);
      await enqueue('B', 2);

      const summary = await drainOutbox(dispatcher);

      expect(summary).toEqual({
        published: 4,
        retried: 0,
        failed: 0,
        deferred: 0,
      });
      expect(consumer.calls.filter((c) => c.startsWith('A:'))).toEqual([
        'A:1',
        'A:2',
      ]);
      expect(consumer.calls.filter((c) => c.startsWith('B:'))).toEqual([
        'B:1',
        'B:2',
      ]);
      expect(await statusOf('A', 2)).toMatchObject({
        status: 'PUBLISHED',
        attempts: 1,
      });
    });

    it('실패한 이벤트는 백오프 뒤 재시도하고, 그동안 같은 파티션의 뒤 이벤트는 순서를 지키려 기다린다(at-least-once)', async () => {
      await enqueue('A', 1);
      await enqueue('A', 2);
      await enqueue('B', 1);
      consumer.failuresLeft.set('A:1', 1);

      const first = await dispatcher.dispatchOnce();
      expect(first).toEqual({
        published: 1,
        retried: 1,
        failed: 0,
        deferred: 1,
      });
      expect(await statusOf('A', 1)).toMatchObject({
        status: 'PENDING',
        attempts: 1,
        next: new Date(START.getTime() + 1_000),
      });
      expect(await statusOf('A', 2)).toMatchObject({
        status: 'PENDING',
        attempts: 0,
      });

      // 백오프 중: A:2만 기한이 됐지만 앞선 A:1 때문에 미룬다
      expect(await dispatcher.dispatchOnce()).toEqual({
        published: 0,
        retried: 0,
        failed: 0,
        deferred: 1,
      });

      now = new Date(START.getTime() + 1_000);
      expect(await drainOutbox(dispatcher)).toMatchObject({
        published: 2,
        retried: 0,
        failed: 0,
      });
      // A:1은 처리 뒤 throw였으므로 두 번 전달됐다 — 소비자 멱등성이 필요한 이유
      expect(consumer.calls.filter((c) => c.startsWith('A:'))).toEqual([
        'A:1',
        'A:1',
        'A:2',
      ]);
    });

    it('재시도 상한을 채우면 FAILED로 남기고, 그 뒤 이벤트는 막지 않는다(DLQ 상태)', async () => {
      cfg.maxAttempts = 2;
      await enqueue('A', 1);
      await enqueue('A', 2);
      consumer.failuresLeft.set('A:1', 99);

      expect(await dispatcher.dispatchOnce()).toEqual({
        published: 0,
        retried: 1,
        failed: 0,
        deferred: 1,
      });
      now = new Date(START.getTime() + 1_000);
      expect(await dispatcher.dispatchOnce()).toEqual({
        published: 1,
        retried: 0,
        failed: 1,
        deferred: 0,
      });

      expect(await statusOf('A', 1)).toMatchObject({
        status: 'FAILED',
        attempts: 2,
      });
      expect(await statusOf('A', 2)).toMatchObject({
        status: 'PUBLISHED',
        attempts: 1,
      });
      // FAILED는 다음 틱에도 다시 잡히지 않는다
      expect(await dispatcher.dispatchOnce()).toEqual({
        published: 0,
        retried: 0,
        failed: 0,
        deferred: 0,
      });
    });

    it('구독자가 없는 event_type은 전달 없이 PUBLISHED, batchSize는 한 틱의 처리량을 자른다', async () => {
      cfg.batchSize = 1;
      await enqueue('A', 1, 'test.none');
      await enqueue('A', 2);

      expect(await dispatcher.dispatchOnce()).toMatchObject({ published: 1 });
      expect(consumer.calls).toEqual([]);
      expect(await dispatcher.dispatchOnce()).toMatchObject({ published: 1 });
      expect(consumer.calls).toEqual(['A:2']);
    });
  });

  describe('tick', () => {
    it('이전 틱이 끝나기 전의 틱은 건너뛴다(같은 이벤트 이중 전달 방지)', async () => {
      await enqueue('A', 1);
      let release!: () => void;
      consumer.block = new Promise<void>((resolve) => {
        release = resolve;
      });

      const running = dispatcher.tick();
      expect(await dispatcher.tick()).toBeNull();
      release();
      expect(await running).toMatchObject({ published: 1 });
      expect(consumer.calls).toEqual(['A:1']);
    });
  });

  describe('반증: 배선 오류', () => {
    it('@SubscribeOutbox가 붙었지만 handle이 없는 provider는 첫 전달에서 즉시 던진다', async () => {
      @Injectable()
      @SubscribeOutbox('test.a')
      class Broken {}

      const { module } = await createTestingModuleWithRealDb({
        imports: [DiscoveryModule],
        providers: [
          OutboxDispatcherService,
          OutboxRepository,
          Broken,
          { provide: AlertService, useValue: alerts },
          { provide: ClockService, useValue: { now: () => now } },
          { provide: ConfigService, useValue: { getOrThrow: () => cfg } },
        ],
      });
      await enqueue('A', 1);

      await expect(
        module.get(OutboxDispatcherService).dispatchOnce(),
      ).rejects.toThrow('handle(event)가 없습니다');
    });
  });
});
