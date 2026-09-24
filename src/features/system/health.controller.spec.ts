import type { Response } from 'express';

import { HealthController } from '@/features/system/health.controller';
import type {
  HealthService,
  ReadinessResult,
} from '@/features/system/services/health.service';

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
