import { ClockService } from '@/common/providers/clock.service';
import { IdGenerator } from '@/common/providers/id-generator.service';
import { OutboxRepository } from '@/features/outbox/repositories/outbox.repository';
import { OutboxMetricsRegistrar } from '@/features/outbox/services/outbox-metrics.registrar';
import { OutboxPublisher } from '@/features/outbox/services/outbox-publisher.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { MetricsService } from '@/global/metrics';
import { RequestContextService } from '@/global/request-context';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

const NOW = new Date('2026-09-25T12:00:00.000Z');

describe('OutboxMetricsRegistrar (real DB)', () => {
  let registrar: OutboxMetricsRegistrar;
  let metrics: MetricsService;
  let repo: OutboxRepository;
  let publisher: OutboxPublisher;
  let prisma: PrismaClient;
  const originalRole = process.env.APP_ROLE;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        OutboxMetricsRegistrar,
        OutboxRepository,
        OutboxPublisher,
        MetricsService,
        IdGenerator,
        RequestContextService,
        { provide: ClockService, useValue: { now: () => NOW } },
      ],
    });
    registrar = module.get(OutboxMetricsRegistrar);
    metrics = module.get(MetricsService);
    // 값의 정확성만 본다 — 운영 상한(2초)은 metrics.service.spec이 검증한다. CI 커버리지 잡의 부하에서 실DB count가
    // 2초를 넘기면 게이지가 빠지고(HELP/TYPE만, 나이 NaN) 이 spec이 헛되이 실패한다(릴리즈 PR #413 coverage-report).
    metrics.collectTimeoutMs = 30_000;
    repo = module.get(OutboxRepository);
    publisher = module.get(OutboxPublisher);
    prisma = p;
  });
  afterAll(async () => {
    if (originalRole === undefined) delete process.env.APP_ROLE;
    else process.env.APP_ROLE = originalRole;
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  async function enqueue(aggregateId: string, occurredAt: Date) {
    return prisma.$transaction((tx) =>
      publisher.publish(tx, {
        aggregateType: 'test',
        aggregateId,
        eventType: 'test.a',
        payload: {},
        occurredAt,
      }),
    );
  }

  it('반증: api 역할에서는 게이지를 등록하지 않는다 — 전역 값이라 복제본마다 노출하면 sum()이 부풀고 DB 쿼리가 N배', async () => {
    process.env.APP_ROLE = 'api';
    registrar.onModuleInit();
    expect(await metrics.text()).not.toContain('caquick_outbox_events');
  });

  it('worker 역할에서는 onModuleInit이 등록한다 — no-op이면 게이지가 영영 안 나온다', async () => {
    process.env.APP_ROLE = 'worker';
    const own = new MetricsService();
    new OutboxMetricsRegistrar(own, repo, {
      now: () => NOW,
    } as ClockService).onModuleInit();
    expect(await own.text()).toContain(
      'caquick_outbox_events{status="PENDING"} 0',
    );
  });

  it('상태별 건수(없는 상태 0)와 기한이 된 PENDING의 나이(초)를 스크레이프 때 계산한다 — 백오프 대기 행은 제외', async () => {
    registrar.register();
    const { eventId: old } = await enqueue(
      'A',
      new Date(NOW.getTime() - 7_200_000),
    ); // 2시간 전
    await enqueue('B', new Date(NOW.getTime() - 60_000));
    await prisma.outbox.update({
      where: { event_id: old },
      data: { status: 'FAILED' },
    });

    let text = await metrics.text();
    expect(text).toContain('caquick_outbox_events{status="PENDING"} 1');
    expect(text).toContain('caquick_outbox_events{status="FAILED"} 1');
    expect(text).toContain('caquick_outbox_events{status="PUBLISHED"} 0');
    expect(text).toContain('caquick_outbox_oldest_pending_age_seconds 60');

    // 남은 PENDING이 백오프 대기 중이면 릴레이 지연이 아니다 → 0
    await prisma.outbox.updateMany({
      where: { status: 'PENDING' },
      data: { next_attempt_at: new Date(NOW.getTime() + 30_000) },
    });
    text = await metrics.text();
    expect(text).toContain('caquick_outbox_oldest_pending_age_seconds 0');
  });
});
