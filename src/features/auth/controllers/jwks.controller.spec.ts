import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { generateEphemeralKeyMaterial } from '@/config/jwt-key';
import { JwksController } from '@/features/auth/controllers/jwks.controller';
import { testAuthConfig } from '@/test/auth-config';

// 토큰 검증자(지금은 같은 프로세스, P4에서는 다른 서비스)가 이 문서만으로 서명을 확인할 수 있어야 한다.
describe('JwksController', () => {
  const keys = generateEphemeralKeyMaterial();

  async function controller(): Promise<JwksController> {
    const module = await Test.createTestingModule({
      controllers: [JwksController],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: () => testAuthConfig({ jwtKeys: keys }),
          },
        },
      ],
    }).compile();
    return module.get(JwksController);
  }

  it('서명 키의 공개 JWK 1벌을 kid·alg·use와 함께 돌려준다', async () => {
    const result = (await controller()).getJwks();

    expect(result.keys).toEqual([
      {
        kty: 'RSA',
        n: keys.publicJwk.n,
        e: keys.publicJwk.e,
        alg: 'RS256',
        use: 'sig',
        kid: keys.kid,
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
