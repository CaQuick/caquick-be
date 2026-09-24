import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PubSub } from 'graphql-subscriptions';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '@/app.module';
import { PUB_SUB } from '@/global/pubsub';
import { PrismaService } from '@/prisma';

// 역할별 리스너 게이트: 컨트롤러가 어느 모듈에 있든 worker에서는 /health·/metrics 밖이 전부 404여야 한다.
// module-wiring.spec은 compile만 보므로 HTTP 노출은 실제 앱을 띄워 본다(DB·Redis는 대역, 디스패처·크론은 env로 끔).
const ENV_DEFAULTS: Record<string, string> = {
  DATABASE_URL: 'mysql://wiring:wiring@localhost:3306/wiring',
  // Redis는 필수 설정(P2 03) — 테스트 컨테이너 주소가 있으면 그것, 없으면 로컬 기본
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379',
  // 브로커도 필수 설정(P2 04) — compile·부팅만 보므로 연결은 하지 않는다(lazy)
  RABBITMQ_URL: 'amqp://guest:guest@localhost:5672',
  OIDC_GOOGLE_ISSUER_URL: 'https://accounts.google.com',
  OIDC_GOOGLE_CLIENT_ID: 'wiring',
  OIDC_GOOGLE_CLIENT_SECRET: 'wiring',
  OIDC_KAKAO_ISSUER_URL: 'https://kauth.kakao.com',
  OIDC_KAKAO_CLIENT_ID: 'wiring',
  OIDC_KAKAO_CLIENT_SECRET: 'wiring',
  OUTBOX_DISPATCH_ENABLED: 'false',
};

describe('역할별 HTTP 노출 (real app)', () => {
  const restored: Array<[string, string | undefined]> = [];
  beforeAll(() => {
    for (const [key, value] of Object.entries(ENV_DEFAULTS)) {
      restored.push([key, process.env[key]]);
      process.env[key] = value;
    }
    restored.push(['APP_ROLE', process.env.APP_ROLE]);
  });
  afterAll(() => {
    for (const [key, value] of restored) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function boot(
    role: 'api' | 'worker',
    envRole: 'api' | 'worker' = role,
  ): Promise<INestApplication<App>> {
    process.env.APP_ROLE = envRole;
    const module = await Test.createTestingModule({
      imports: [AppModule.forRole(role)],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn(),
        $disconnect: jest.fn(),
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
      })
      .overrideProvider(PUB_SUB)
      .useValue(Object.assign(new PubSub(), { close: () => Promise.resolve() }))
      .compile();
    const app = module.createNestApplication<INestApplication<App>>();
    await app.init();
    return app;
  }

  describe('worker', () => {
    let app: INestApplication<App>;
    beforeAll(async () => {
      app = await boot('worker');
    });
    afterAll(() => app.close());

    it('헬스는 연다', async () => {
      await request(app.getHttpServer()).get('/health/live').expect(200);
    });

    // 반증 전수 — feature 컨트롤러·GraphQL·정적 문서가 worker에서 응답하면 안 된다.
    it.each([
      ['GET', '/auth/oidc/google/start'],
      ['GET', '/.well-known/jwks.json'],
      ['POST', '/graphql'],
      ['GET', '/rest-docs'],
      ['GET', '/gql-docs'],
    ])('%s %s → 404 ROUTE_NOT_FOUND', async (method, path) => {
      const res = await (
        method === 'POST'
          ? request(app.getHttpServer())
              .post(path)
              .send({ query: '{ __typename }' })
          : request(app.getHttpServer()).get(path)
      ).expect(404);
      expect((res.body as { errorCode?: string }).errorCode).toBe(
        'ROUTE_NOT_FOUND',
      );
    });
  });

  // configure()의 미들웨어 게이트가 env를 다시 읽으면 imports 배선(forRole 인자)과 어긋난다 — 인자가 한 값으로 둘 다 정한다
  describe('forRole 인자와 env가 다르면 인자가 이긴다', () => {
    it('forRole(worker)·env api: feature 라우트는 404, 헬스는 200', async () => {
      const app = await boot('worker', 'api');
      try {
        await request(app.getHttpServer()).get('/health/live').expect(200);
        const res = await request(app.getHttpServer())
          .get('/auth/oidc/google/start')
          .expect(404);
        expect((res.body as { errorCode?: string }).errorCode).toBe(
          'ROUTE_NOT_FOUND',
        );
      } finally {
        await app.close();
      }
    });

    it('forRole(api)·env worker: JWKS가 열린다', async () => {
      const app = await boot('api', 'worker');
      try {
        await request(app.getHttpServer())
          .get('/.well-known/jwks.json')
          .expect(200);
      } finally {
        await app.close();
      }
    });
  });

  describe('api', () => {
    let app: INestApplication<App>;
    beforeAll(async () => {
      app = await boot('api');
    });
    afterAll(() => app.close());

    it('같은 코드가 api 역할에서는 JWKS·GraphQL을 연다(대조군)', async () => {
      const jwks = await request(app.getHttpServer())
        .get('/.well-known/jwks.json')
        .expect(200);
      expect(Array.isArray((jwks.body as { keys?: unknown }).keys)).toBe(true);
      await request(app.getHttpServer())
        .post('/graphql')
        .send({ query: '{ __typename }' })
        .expect(200);
    });
  });
});
