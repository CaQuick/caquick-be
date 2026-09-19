import { ClockService } from '@/common/providers/clock.service';
import { IdGenerator } from '@/common/providers/id-generator.service';
import { OutboxRepository } from '@/features/outbox/repositories/outbox.repository';
import { OutboxPublisher } from '@/features/outbox/services/outbox-publisher.service';
import type { PrismaClient } from '@/generated/prisma/client';
import { RequestContextService } from '@/global/request-context';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

const NOW = new Date('2026-09-19T12:00:00.000Z');
let seq = 0;
const uuidAt = (n: number) =>
  `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;

describe('OutboxPublisher (real DB)', () => {
  let publisher: OutboxPublisher;
  let requestContext: RequestContextService;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      providers: [
        OutboxPublisher,
        OutboxRepository,
        { provide: ClockService, useValue: { now: () => NOW } },
        { provide: IdGenerator, useValue: { uuid: () => uuidAt(++seq) } },
      ],
    });
    publisher = module.get(OutboxPublisher);
    requestContext = module.get(RequestContextService);
    prisma = p;
  });
  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });
  beforeEach(async () => {
    await truncateAll();
    seq = 0;
  });

  const input = {
    aggregateType: 'order',
    aggregateId: '42',
    eventType: 'order.status_changed',
    payload: { orderNumber: 'ORD-1', to: 'CONFIRMED' },
    actorAccountId: 7n,
  };

  it('본 조작 tx 안에 PENDING 이벤트를 적재하고 ip/ua는 요청 컨텍스트(ALS)에서 채운다', async () => {
    const { eventId } = await requestContext.run(
      { clientIp: '10.0.0.1', userAgent: 'jest-ua' },
      () => prisma.$transaction((tx) => publisher.publish(tx, input)),
    );

    expect(eventId).toBe(uuidAt(1));
    const row = await prisma.outbox.findUniqueOrThrow({
      where: { event_id: uuidAt(1) },
    });
    expect(row).toMatchObject({
      aggregate_type: 'order',
      aggregate_id: '42',
      event_type: 'order.status_changed',
      payload_json: { orderNumber: 'ORD-1', to: 'CONFIRMED' },
      occurred_at: NOW,
      next_attempt_at: NOW,
      actor_account_id: 7n,
      client_ip: '10.0.0.1',
      user_agent: 'jest-ua',
      status: 'PENDING',
      attempts: 0,
    });
  });

  it('tx가 롤백되면 이벤트도 남지 않는다(도메인 write와 원자적)', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await publisher.publish(tx, input);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await prisma.outbox.count()).toBe(0);
  });

  it('컨텍스트 밖이면 ip/ua·actor는 null, malformed ip는 버리고 ua는 512자로 자르며, occurredAt 명시값이 우선한다', async () => {
    const occurredAt = new Date('2026-09-18T00:00:00.000Z');
    await prisma.$transaction((tx) =>
      publisher.publish(tx, {
        ...input,
        actorAccountId: undefined,
        occurredAt,
      }),
    );
    await requestContext.run(
      { clientIp: 'not-an-ip', userAgent: 'x'.repeat(600) },
      () =>
        prisma.$transaction((tx) =>
          publisher.publish(tx, { ...input, aggregateId: '43' }),
        ),
    );

    const [outside, inside] = await prisma.outbox.findMany({
      orderBy: { id: 'asc' },
    });
    expect(outside).toMatchObject({
      actor_account_id: null,
      client_ip: null,
      user_agent: null,
      occurred_at: occurredAt,
      next_attempt_at: occurredAt,
    });
    expect(inside.client_ip).toBeNull();
    expect(inside.user_agent).toHaveLength(512);
  });

  it('publishOnce는 같은 eventId를 두 번 적재하지 않고 처음 payload를 돌려주며, findPublished는 tx 밖에서 같은 것을 읽는다', async () => {
    const eventId = uuidAt(99);
    const first = await prisma.$transaction((tx) =>
      publisher.publishOnce(tx, { ...input, eventId }),
    );
    const replay = await prisma.$transaction((tx) =>
      publisher.publishOnce(tx, { ...input, eventId, payload: { changed: 1 } }),
    );

    expect(first).toEqual({ eventId, created: true, payload: input.payload });
    expect(replay).toEqual({ eventId, created: false, payload: input.payload });
    expect(await prisma.outbox.count()).toBe(1);
    expect(await publisher.findPublished(eventId)).toEqual({
      eventId,
      payload: input.payload,
    });
    expect(await publisher.findPublished(uuidAt(98))).toBeNull();
  });
});
