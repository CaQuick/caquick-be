import type { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';

import { DomainException } from '@/common/errors/error-catalog';
import { ClockService } from '@/common/providers/clock.service';
import { AuthService } from '@/features/auth/auth.service';
import { AuthController } from '@/features/auth/controllers/auth.controller';
import { CredentialAuthService } from '@/features/auth/services/credential-auth.service';
import { OidcLoginService } from '@/features/auth/services/oidc-login.service';
import { HttpExceptionFilter } from '@/global/filters/global-exception.filter';
import { GraphQLExceptionFilter } from '@/global/filters/graphql-exception.filter';
import { CustomLoggerService } from '@/global/logger/custom-logger.service';
import { MetricsService } from '@/global/metrics';
import { connectTestRedis } from '@/test/db/redis-test-client';
import { listenOnLoopback } from '@/test/http-app';
import { redisTestProviders } from '@/test/redis';

const T0 = new Date('2026-10-03T12:00:00.000Z');
const WINDOW_SECONDS = 900;

class FixedClock extends ClockService {
  at = T0;
  override now(): Date {
    return this.at;
  }
}

type ErrorBody = { code: number; errorCode: string | null; message: string };

// 가드가 파싱된 바디의 username을 읽는다는 건 HTTP로만 증명된다(가드 단위 spec은 req를 손으로 만든다).
describe('로그인 rate limit (real app + real Redis)', () => {
  let app: INestApplication<App>;
  let redis: Redis;
  const clock = new FixedClock();
  const login = jest.fn();

  beforeAll(async () => {
    redis = await connectTestRedis();
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: OidcLoginService, useValue: {} },
        { provide: CredentialAuthService, useValue: { login } },
        { provide: ClockService, useValue: clock },
        ...redisTestProviders(redis),
      ],
    }).compile();
    app = module.createNestApplication<INestApplication<App>>();
    const logger = new CustomLoggerService();
    logger.txError = jest.fn();
    app.useGlobalFilters(
      new HttpExceptionFilter(
        app.get(HttpAdapterHost).httpAdapter,
        logger,
        new GraphQLExceptionFilter(logger, new MetricsService()),
      ),
    );
    await listenOnLoopback(app);
  });
  afterAll(async () => {
    await app?.close();
    await redis.quit();
  });
  beforeEach(async () => {
    await redis.flushdb();
    clock.at = T0;
    login.mockReset();
    login.mockRejectedValue(new DomainException('INVALID_CREDENTIALS'));
  });

  function attempt(
    path: '/auth/seller/login' | '/auth/admin/login',
    username: string,
  ): request.Test {
    return request(app.getHttpServer())
      .post(path)
      .send({ username, password: 'wrong-password' });
  }

  async function expectRejectedTimes(
    path: '/auth/seller/login' | '/auth/admin/login',
    username: string,
    times: number,
  ): Promise<void> {
    for (let i = 0; i < times; i++) {
      await attempt(path, username).expect(401);
    }
  }

  it('같은 username은 5회까지 401, 6회째는 429 LOGIN_RATE_LIMITED이고 서비스까지 가지 않는다', async () => {
    await expectRejectedTimes('/auth/seller/login', 'alice', 5);

    const res = await attempt('/auth/seller/login', 'alice').expect(429);

    const body = res.body as ErrorBody;
    expect(body.errorCode).toBe('LOGIN_RATE_LIMITED');
    expect(body.message).toContain('15분');
    expect(login).toHaveBeenCalledTimes(5);
  });

  it('반증: 다른 username은 6회째도 401이다', async () => {
    await expectRejectedTimes('/auth/seller/login', 'alice', 5);

    await attempt('/auth/seller/login', 'bob').expect(401);
  });

  it('username 대소문자·공백이 달라도 같은 계정으로 센다', async () => {
    await expectRejectedTimes('/auth/seller/login', 'Alice', 5);

    await attempt('/auth/seller/login', ' alice ').expect(429);
  });

  it('관리자 로그인은 판매자와 따로 세고 같은 한도를 갖는다', async () => {
    await expectRejectedTimes('/auth/seller/login', 'alice', 5);

    await expectRejectedTimes('/auth/admin/login', 'alice', 5);
    const res = await attempt('/auth/admin/login', 'alice').expect(429);
    expect((res.body as ErrorBody).errorCode).toBe('LOGIN_RATE_LIMITED');
  });

  it('username을 바꿔 가며 찍어도 IP 30회를 넘기면 429다', async () => {
    for (let i = 0; i < 30; i++) {
      await attempt('/auth/seller/login', `user-${i}`).expect(401);
    }

    const res = await attempt('/auth/seller/login', 'user-30').expect(429);
    expect((res.body as ErrorBody).errorCode).toBe('LOGIN_RATE_LIMITED');
  });

  it('창이 지나면 다시 401이다', async () => {
    await expectRejectedTimes('/auth/seller/login', 'alice', 5);
    await attempt('/auth/seller/login', 'alice').expect(429);

    clock.at = new Date(T0.getTime() + WINDOW_SECONDS * 1000);

    await attempt('/auth/seller/login', 'alice').expect(401);
  });
});
