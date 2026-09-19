import { Controller, Get, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { generateEphemeralKeyMaterial } from '@/config/jwt-key';
import { JwksController } from '@/features/auth/controllers/jwks.controller';
import {
  ApiResponseInterceptor,
  RAW_RESPONSE_PATHS,
} from '@/global/interceptors/api-response.interceptor';
import { testAuthConfig } from '@/test/auth-config';

const KEYS = generateEphemeralKeyMaterial();

function configProvider() {
  return {
    provide: ConfigService,
    useValue: { getOrThrow: () => testAuthConfig({ jwtKeys: KEYS }) },
  };
}

// 토큰 검증자(지금은 같은 프로세스, P4에서는 다른 서비스)가 이 문서만으로 서명을 확인할 수 있어야 한다.
describe('JwksController', () => {
  async function controller(): Promise<JwksController> {
    const module = await Test.createTestingModule({
      controllers: [JwksController],
      providers: [configProvider()],
    }).compile();
    return module.get(JwksController);
  }

  it('서명 키의 공개 JWK 1벌을 kid·alg·use와 함께 돌려준다', async () => {
    const result = (await controller()).getJwks();

    expect(result.keys).toEqual([
      {
        kty: 'RSA',
        n: KEYS.publicJwk.n,
        e: KEYS.publicJwk.e,
        alg: 'RS256',
        use: 'sig',
        kid: KEYS.kid,
      },
    ]);
  });

  it('개인키는 절대 싣지 않는다', async () => {
    const result = (await controller()).getJwks();

    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(Object.keys(result.keys[0])).toEqual([
      'kty',
      'n',
      'e',
      'alg',
      'use',
      'kid',
    ]);
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

// 컨트롤러 반환값이 아니라 **실제로 나가는 본문**을 본다 — 전역 봉투에 싸이는 사고가 여기서만 잡힌다.
describe('JWKS HTTP 응답', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [JwksController, EnvelopeProbeController],
      providers: [configProvider()],
    }).compile();
    app = module.createNestApplication();
    // main.ts와 같은 배선(같은 상수)
    app.useGlobalInterceptors(new ApiResponseInterceptor(RAW_RESPONSE_PATHS));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('표준 JWK Set으로 나간다 — 최상위가 keys 하나뿐', async () => {
    const res = await request(app.getHttpServer())
      .get('/.well-known/jwks.json')
      .expect(200);
    const body = res.body as { keys?: unknown };

    expect(Object.keys(body)).toEqual(['keys']);
    expect(body.keys).toEqual([
      {
        kty: 'RSA',
        n: KEYS.publicJwk.n,
        e: KEYS.publicJwk.e,
        alg: 'RS256',
        use: 'sig',
        kid: KEYS.kid,
      },
    ]);
  });

  it('반증: 제외 목록 밖 경로는 같은 앱에서 봉투에 싸인다', async () => {
    const res = await request(app.getHttpServer())
      .get('/envelope-probe')
      .expect(200);
    const body = res.body as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual([
      'code',
      'data',
      'errorCode',
      'message',
    ]);
    expect(body.data).toEqual({ ok: true });
  });
});
