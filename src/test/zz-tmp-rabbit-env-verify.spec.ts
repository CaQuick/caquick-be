import { Test } from '@nestjs/testing';
import { PubSub } from 'graphql-subscriptions';

import { AppModule } from '@/app.module';
import { RabbitConnectionService } from '@/features/outbox/rabbitmq/rabbit-connection.service';
import { PUB_SUB } from '@/global/pubsub';
import { PrismaService } from '@/prisma';

const ENV: Record<string, string> = {
  DATABASE_URL: 'mysql://wiring:wiring@localhost:3306/wiring',
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379',
  OIDC_GOOGLE_ISSUER_URL: 'https://accounts.google.com',
  OIDC_GOOGLE_CLIENT_ID: 'wiring',
  OIDC_GOOGLE_CLIENT_SECRET: 'wiring',
  OIDC_KAKAO_ISSUER_URL: 'https://kauth.kakao.com',
  OIDC_KAKAO_CLIENT_ID: 'wiring',
  OIDC_KAKAO_CLIENT_SECRET: 'wiring',
};

function builder(role: 'api' | 'ws' | 'worker') {
  return Test.createTestingModule({ imports: [AppModule.forRole(role)] })
    .overrideProvider(PrismaService)
    .useValue({ $connect: jest.fn(), $disconnect: jest.fn(), onModuleInit: jest.fn(), onModuleDestroy: jest.fn() })
    .overrideProvider(PUB_SUB)
    .useValue(Object.assign(new PubSub(), { close: () => Promise.resolve() }));
}

describe('TMP verify: RABBITMQ_URL requirement per role', () => {
  beforeAll(() => {
    for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
  });

  it.each(['api', 'ws', 'worker'] as const)('%s: RABBITMQ_URL unset → compile rejects', async (role) => {
    delete process.env.RABBITMQ_URL;
    process.env.APP_ROLE = role;
    await expect(builder(role).compile()).rejects.toThrow(/RABBITMQ_URL must be set/);
  });

  it('api: unreachable RABBITMQ_URL → init OK, no connection attempted (lazy, unused)', async () => {
    process.env.RABBITMQ_URL = 'amqp://guest:guest@127.0.0.1:1';
    process.env.APP_ROLE = 'api';
    const module = await builder('api').compile();
    const app = module.createNestApplication();
    await app.init();
    const rabbit = app.get(RabbitConnectionService);
    expect(rabbit.isConnected('publisher')).toBe(false);
    expect(rabbit.isConnected('consumer')).toBe(false);
    await app.close();
  });
});
