import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';

import { HealthController } from '@/features/system/health.controller';
import {
  HealthService,
  type ReadinessResult,
} from '@/features/system/services/health.service';
import {
  ApiResponseInterceptor,
  RAW_RESPONSE_PATHS,
} from '@/global/interceptors/api-response.interceptor';

function controllerWith(result: ReadinessResult): HealthController {
  const service = { ready: () => Promise.resolve(result) } as HealthService;
  return new HealthController(service);
}

function fakeRes(): Response & { statusCode: number } {
  const res = { statusCode: 200 } as Response & { statusCode: number };
  res.status = ((code: number) => {
    res.statusCode = code;
    return res;
  }) as Response['status'];
  return res;
}

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = controllerWith({ ok: true, checks: {} });
  });

  it('getHealth·getLive: 의존성과 무관하게 status:ok', () => {
    expect(controller.getHealth()).toEqual({ status: 'ok' });
    expect(controller.getLive()).toEqual({ status: 'ok' });
  });

  it('getReady: 전부 up이면 200', async () => {
    const res = fakeRes();
    const body = await controllerWith({
      ok: true,
      checks: { mysql: 'up', redis: 'up' },
    }).getReady(res);
    expect(res.statusCode).toBe(200);
    expect(body).toEqual({
      status: 'ok',
      checks: { mysql: 'up', redis: 'up' },
    });
  });

  it('반증: 하나라도 down이면 503과 degraded', async () => {
    const res = fakeRes();
    const body = await controllerWith({
      ok: false,
      checks: { mysql: 'up', redis: 'down' },
    }).getReady(res);
    expect(res.statusCode).toBe(503);
    expect(body).toEqual({
      status: 'degraded',
      checks: { mysql: 'up', redis: 'down' },
    });
  });

  it('getProfiles: PROFILE/PORT 환경변수를 응답에 포함한다', () => {
    const originalProfile = process.env.PROFILE;
    const originalPort = process.env.PORT;
    process.env.PROFILE = 'test-profile';
    process.env.PORT = '3001';

    try {
      const result = controller.getProfiles();
      expect(result).toEqual({
        status: 'ok',
        profile: 'test-profile',
        port: '3001',
      });
    } finally {
      if (originalProfile === undefined) delete process.env.PROFILE;
      else process.env.PROFILE = originalProfile;
      if (originalPort === undefined) delete process.env.PORT;
      else process.env.PORT = originalPort;
    }
  });

  it('getProfiles: PROFILE 미설정이면 unknown 폴백', () => {
    const original = process.env.PROFILE;
    delete process.env.PROFILE;

    try {
      expect(controller.getProfiles().profile).toBe('unknown');
    } finally {
      if (original !== undefined) process.env.PROFILE = original;
    }
  });
});

/** 제외 목록 밖 경로가 실제로 봉투에 싸이는지 볼 대조군. 없으면 "봉투 없음"이 무의미하게 통과한다. */
@Controller('envelope-probe')
class EnvelopeProbeController {
  @Get()
  get(): { ok: boolean } {
    return { ok: true };
  }
}

// 컨트롤러 반환값이 아니라 **실제로 나가는 상태·본문**을 본다 — @Res passthrough가 빠지거나 봉투에 싸이는 사고는 여기서만 잡힌다.
describe('헬스 HTTP 응답 (real app)', () => {
  let app: INestApplication<App>;
  let ready: ReadinessResult;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController, EnvelopeProbeController],
      providers: [
        {
          provide: HealthService,
          useValue: { ready: () => Promise.resolve(ready) },
        },
      ],
    }).compile();
    app = module.createNestApplication<INestApplication<App>>();
    // main.ts와 같은 배선(같은 상수)
    app.useGlobalInterceptors(new ApiResponseInterceptor(RAW_RESPONSE_PATHS));
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('반증: 하나라도 down이면 HTTP 503이고 본문은 봉투 없는 degraded — compose healthcheck가 읽는 형태', async () => {
    ready = { ok: false, checks: { mysql: 'up', redis: 'down' } };
    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);
    expect(res.body).toEqual({
      status: 'degraded',
      checks: { mysql: 'up', redis: 'down' },
    });
  });

  it('전부 up이면 200 + 봉투 없는 ok', async () => {
    ready = { ok: true, checks: { mysql: 'up', redis: 'up' } };
    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { mysql: 'up', redis: 'up' },
    });
  });

  it('끝 슬래시(/health/ready/)도 같은 핸들러·같은 봉투 제외 — 상태와 본문이 어긋나지 않는다', async () => {
    ready = { ok: false, checks: { mysql: 'down' } };
    const res = await request(app.getHttpServer())
      .get('/health/ready/')
      .expect(503);
    expect(res.body).toEqual({ status: 'degraded', checks: { mysql: 'down' } });
  });

  it('대소문자 변형(/HEALTH/READY)도 같은 핸들러·같은 봉투 제외', async () => {
    ready = { ok: false, checks: { redis: 'down' } };
    const res = await request(app.getHttpServer())
      .get('/HEALTH/READY')
      .expect(503);
    expect(res.body).toEqual({ status: 'degraded', checks: { redis: 'down' } });
  });

  it('/health/live도 봉투 없이 나간다', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('대조군: 제외 목록 밖 경로는 봉투에 싸인다', async () => {
    const res = await request(app.getHttpServer())
      .get('/envelope-probe')
      .expect(200);
    expect(res.body).toMatchObject({ data: { ok: true } });
    expect(Object.keys(res.body as object)).not.toEqual(['ok']);
  });
});
