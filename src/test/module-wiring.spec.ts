import { Injectable } from '@nestjs/common';
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

  it('모든 feature 모듈의 provider가 resolve된다', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      // 외부 연결은 배선 검사와 무관 — DB·Redis 없이 compile만 한다
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
      .overrideProvider(PUB_SUB)
      .useValue(Object.assign(new PubSub(), { close: () => Promise.resolve() }))
      .compile();
    expect(module).toBeDefined();
    await module.close();
  });

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
