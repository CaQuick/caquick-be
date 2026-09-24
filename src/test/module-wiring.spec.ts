import { Injectable } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { PubSub } from 'graphql-subscriptions';

import { AppModule } from '@/app.module';
import { PUB_SUB } from '@/global/pubsub';
import { PrismaService } from '@/prisma';

// 부팅 배선 게이트: 각 spec은 provider를 직접 넣어 모듈 imports 누락(다른 모듈이 export한 provider를 안 가져온 경우)을 못 잡는다.
// AppModule을 compile만 해서(리스닝·스키마 빌드 없음) 모든 provider가 실제 모듈 경계 안에서 resolve되는지 본다.
const ENV_DEFAULTS: Record<string, string> = {
  DATABASE_URL: 'mysql://wiring:wiring@localhost:3306/wiring',
  OIDC_GOOGLE_ISSUER_URL: 'https://accounts.google.com',
  OIDC_GOOGLE_CLIENT_ID: 'wiring',
  OIDC_GOOGLE_CLIENT_SECRET: 'wiring',
  OIDC_KAKAO_ISSUER_URL: 'https://kauth.kakao.com',
  OIDC_KAKAO_CLIENT_ID: 'wiring',
  OIDC_KAKAO_CLIENT_SECRET: 'wiring',
};

describe('모듈 배선 (AppModule compile)', () => {
  const restored: Array<[string, string | undefined]> = [];
  beforeAll(() => {
    for (const [key, value] of Object.entries(ENV_DEFAULTS)) {
      if (process.env[key]) continue;
      restored.push([key, process.env[key]]);
      process.env[key] = value;
    }
  });
  afterAll(() => {
    for (const [key, value] of restored) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function compileRole(role: 'api' | 'ws' | 'worker') {
    return (
      Test.createTestingModule({ imports: [AppModule.forRole(role)] })
        // 외부 연결은 배선 검사와 무관 — DB·Redis 없이 compile만 한다
        .overrideProvider(PrismaService)
        .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
        .overrideProvider(PUB_SUB)
        .useValue(
          Object.assign(new PubSub(), { close: () => Promise.resolve() }),
        )
        .compile()
    );
  }

  // 역할 전수 — 어느 역할이든 모든 provider가 resolve되고, 역할에 없는 책임(GraphQL·크론)은 실리지 않는다.
  it.each([
    ['api', true, false],
    ['ws', true, false],
    ['worker', false, true],
  ] as const)(
    '%s 역할: provider 전부 resolve, graphql=%s, schedule=%s',
    async (role, graphql, schedule) => {
      const module = await compileRole(role);
      const has = (token: unknown) => {
        try {
          module.get(token as never, { strict: false });
          return true;
        } catch {
          return false;
        }
      };
      expect(has(GraphQLModule)).toBe(graphql);
      expect(has(SchedulerRegistry)).toBe(schedule);
      await module.close();
    },
  );

  it('반증: import하지 않은 모듈의 provider에 의존하면 compile이 실패한다', async () => {
    @Injectable()
    class Missing {}
    @Injectable()
    class NeedsMissing {
      constructor(readonly missing: Missing) {}
    }
    await expect(
      Test.createTestingModule({ providers: [NeedsMissing] }).compile(),
    ).rejects.toThrow(/can't resolve dependencies/);
  });
});
