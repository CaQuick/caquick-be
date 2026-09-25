import { readRabbitmqConfig } from '@/config/rabbitmq.config';

describe('rabbitmqConfig', () => {
  it('RABBITMQ_URL을 읽는다', () => {
    expect(
      readRabbitmqConfig({ RABBITMQ_URL: ' amqp://u:p@broker:5672 ' }),
    ).toEqual({ url: 'amqp://u:p@broker:5672' });
  });

  it.each([undefined, '', '  '])('반증: 미설정(%p)이면 던진다', (value) => {
    expect(() => readRabbitmqConfig({ RABBITMQ_URL: value })).toThrow(
      'RABBITMQ_URL',
    );
  });
});
