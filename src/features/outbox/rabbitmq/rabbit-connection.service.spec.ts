import type { ConfigService } from '@nestjs/config';
import amqplib from 'amqplib';

import {
  RabbitConnectionService,
  withHeartbeat,
} from '@/features/outbox/rabbitmq/rabbit-connection.service';
import type { AlertService } from '@/global/alerting';

jest.mock('amqplib', () => ({
  __esModule: true,
  default: { connect: jest.fn() },
}));

function fakeConnection() {
  return {
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
    createConfirmChannel: jest.fn(),
  };
}

describe('RabbitConnectionService', () => {
  const connect = amqplib.connect as jest.Mock;
  const build = () =>
    new RabbitConnectionService(
      {
        getOrThrow: () => ({ url: 'amqp://guest:guest@localhost:5672' }),
      } as unknown as ConfigService,
      { notify: jest.fn() } as unknown as AlertService,
    );

  beforeEach(() => connect.mockReset());

  it.each([
    ['amqp://h:5672', 'amqp://h:5672?heartbeat=10'],
    [
      'amqp://h:5672/vhost?frameMax=0',
      'amqp://h:5672/vhost?frameMax=0&heartbeat=10',
    ],
    ['amqps://h?heartbeat=30', 'amqps://h?heartbeat=30'],
  ])('withHeartbeat: %s → %s', (input, expected) => {
    expect(withHeartbeat(input)).toBe(expected);
  });

  it('발행과 소비는 커넥션을 따로 연다(연결 이름으로 구분) — 브로커 알람이 발행 소켓을 막아도 소비는 간다', async () => {
    connect.mockImplementation(() => Promise.resolve(fakeConnection()));
    const service = build();

    const publisher = await service.getConnection('publisher');
    const consumer = await service.getConnection('consumer');

    expect(publisher).not.toBe(consumer);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(
      connect.mock.calls
        .map(
          ([, opts]) =>
            (opts as { clientProperties: { connection_name: string } })
              .clientProperties.connection_name,
        )
        .sort(),
    ).toEqual(['caquick-consumer', 'caquick-publisher']);
    expect(await service.getConnection('publisher')).toBe(publisher); // 캐시
  });

  it('반증: 백오프 대기 중 종료하면 즉시 깨어나 던지고 다시 연결하지 않는다', async () => {
    connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const service = build();
    await expect(service.getConnection('consumer')).rejects.toThrow(
      'ECONNREFUSED',
    );

    const pending = service.getConnection('consumer'); // failures=1 → 500ms 백오프
    await new Promise((r) => setTimeout(r, 20));
    const started = Date.now();
    await service.onApplicationShutdown();
    await expect(pending).rejects.toThrow('종료 중');
    expect(Date.now() - started).toBeLessThan(400);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('retire는 close를 최대 1초만 기다리고 소켓을 강제로 끊는다 — blocked 커넥션의 close 핸드셰이크에 매달리지 않게', async () => {
    const destroy = jest.fn();
    const stuck = {
      ...fakeConnection(),
      close: jest.fn(() => new Promise<void>(() => undefined)),
      connection: { stream: { destroy } },
    };
    connect.mockResolvedValue(stuck);
    const service = build();
    await service.getConnection('consumer');

    const started = Date.now();
    await service.retire('consumer');

    expect(Date.now() - started).toBeLessThan(1_500);
    expect(destroy).toHaveBeenCalled();
    expect(service.isConnected('consumer')).toBe(false);
  });

  it('반증: 종료가 시작된 뒤 완료된 connect는 닫고 던진다 — 늦게 열린 소켓이 프로세스를 붙잡지 않게', async () => {
    let finish: (c: ReturnType<typeof fakeConnection>) => void = () =>
      undefined;
    const late = fakeConnection();
    connect.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const service = build();

    const pending = service.getConnection('consumer');
    await service.onApplicationShutdown();
    finish(late);

    await expect(pending).rejects.toThrow('종료 중');
    expect(late.close).toHaveBeenCalled();
    await expect(service.getConnection('consumer')).rejects.toThrow('종료 중');
  });
});
