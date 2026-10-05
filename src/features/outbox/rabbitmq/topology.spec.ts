import type { ConfirmChannel } from 'amqplib';

import {
  assertTopology,
  EVENTS_EXCHANGE,
  parseMessage,
  queuesFor,
  toEvent,
  toMessage,
} from '@/features/outbox/rabbitmq/topology';
import type { OutboxRow } from '@/features/outbox/repositories/outbox.repository';

const ROW: OutboxRow = {
  id: BigInt(12),
  event_id: 'e-1',
  aggregate_type: 'order',
  aggregate_id: '7',
  event_type: 'order.status_changed',
  payload_json: { status: 'CONFIRMED' },
  occurred_at: new Date('2026-09-24T12:00:00.000Z'),
  actor_account_id: BigInt(3),
  client_ip: '203.0.113.9',
  user_agent: 'ua',
  status: 'PENDING',
  attempts: 0,
  next_attempt_at: new Date('2026-09-24T12:00:00.000Z'),
  created_at: new Date('2026-09-24T12:00:00.000Z'),
};

describe('rabbitmq topology', () => {
  it('소비자 이름 하나 = 큐 3개(main·retry·dlq)', () => {
    expect(queuesFor('NotificationOutboxConsumer')).toEqual({
      main: 'q.NotificationOutboxConsumer',
      retry: 'q.NotificationOutboxConsumer.retry',
      dlq: 'q.NotificationOutboxConsumer.dlq',
    });
  });

  it('row → 메시지 → 이벤트가 왕복하고 bigint·Date가 보존된다(attempts는 헤더에서)', () => {
    const message = toMessage(ROW);
    expect(message).toEqual({
      id: '12',
      eventId: 'e-1',
      aggregateType: 'order',
      aggregateId: '7',
      eventType: 'order.status_changed',
      payload: { status: 'CONFIRMED' },
      occurredAt: '2026-09-24T12:00:00.000Z',
      actorAccountId: '3',
      clientIp: '203.0.113.9',
      userAgent: 'ua',
    });
    const parsed = parseMessage(Buffer.from(JSON.stringify(message)));
    expect(toEvent(parsed, 2)).toEqual({
      id: BigInt(12),
      eventId: 'e-1',
      aggregateType: 'order',
      aggregateId: '7',
      eventType: 'order.status_changed',
      payload: { status: 'CONFIRMED' },
      occurredAt: new Date('2026-09-24T12:00:00.000Z'),
      actorAccountId: BigInt(3),
      clientIp: '203.0.113.9',
      userAgent: 'ua',
      attempts: 2,
    });
  });

  it('actor가 없으면 null 그대로', () => {
    expect(
      toMessage({ ...ROW, actor_account_id: null }).actorAccountId,
    ).toBeNull();
    expect(
      toEvent({ ...toMessage(ROW), actorAccountId: null }, 0).actorAccountId,
    ).toBeNull();
  });

  // 반증 전수 — 형식이 아닌 본문은 "정상 소비"로 삼키지 않고 던진다(→ DLQ)
  it.each([
    ['JSON 아님', 'not json'],
    ['객체 아님', '"x"'],
    ['eventId 없음', JSON.stringify({ id: '1', eventType: 'a' })],
    ['id 없음', JSON.stringify({ eventId: 'e', eventType: 'a' })],
  ])('반증: %s → 던진다', (_label, body) => {
    expect(() => parseMessage(Buffer.from(body))).toThrow();
  });

  it('반증: 두 소비자가 같은 event_type을 구독하면 큐 2개에 각각 바인딩된다(fan-out은 바인딩으로)', async () => {
    const bindQueue = jest.fn().mockResolvedValue(undefined);
    const channel = {
      assertExchange: jest.fn().mockResolvedValue(undefined),
      assertQueue: jest.fn().mockResolvedValue(undefined),
      bindQueue,
    } as unknown as ConfirmChannel;

    await assertTopology(channel, [
      { queues: queuesFor('A'), eventTypes: ['order.submitted'] },
      {
        queues: queuesFor('B'),
        eventTypes: ['order.submitted', 'order.status_changed'],
      },
    ]);

    const eventBindings = bindQueue.mock.calls.filter(
      ([, exchange]) => exchange === EVENTS_EXCHANGE,
    );
    expect(eventBindings).toEqual([
      ['q.A', EVENTS_EXCHANGE, 'order.submitted'],
      ['q.B', EVENTS_EXCHANGE, 'order.submitted'],
      ['q.B', EVENTS_EXCHANGE, 'order.status_changed'],
    ]);
  });
});
