import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';

import authConfig from '@/config/auth.config';
import { generateEphemeralKeyMaterial } from '@/config/jwt-key';
import { AuthGlobalModule } from '@/global/auth/auth-global.module';

const ENV_KEYS = [
  'JWT_PRIVATE_KEY_PEM_B64',
  'JWT_ISSUER',
  'JWT_AUDIENCE',
] as const;

const KEYS = generateEphemeralKeyMaterial();

// JwtModule이 authConfig의 RS256 키·iss·aud·kid로 서명하는지 본다(P1-13).
describe('AuthGlobalModule', () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
    {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.JWT_PRIVATE_KEY_PEM_B64 = Buffer.from(
      KEYS.privateKeyPem,
      'utf8',
    ).toString('base64');
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  async function compile(): Promise<JwtService> {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [authConfig],
        }),
        AuthGlobalModule,
      ],
    }).compile();
    return module.get(JwtService);
  }

  it('설정된 개인키로 RS256 서명하고 공개키로 검증된다', async () => {
    const jwt = await compile();

    const token = jwt.sign({ sub: '1', typ: 'access', role: 'USER' });

    expect(
      jwt.verify(token, {
        publicKey: KEYS.publicKeyPem,
        algorithms: ['RS256'],
        issuer: 'caquick-identity',
        audience: 'caquick-api',
      }),
    ).toMatchObject({ sub: '1', typ: 'access', role: 'USER' });
  });

  it('헤더에 kid(RFC 7638 썸프린트)와 alg RS256을 싣고, iss·aud·exp를 서명 옵션이 채운다', async () => {
    const jwt = await compile();

    const token = jwt.sign({ sub: '1', typ: 'access', role: 'USER' });
    const [rawHeader] = token.split('.');
    const header = JSON.parse(
      Buffer.from(rawHeader, 'base64url').toString('utf8'),
    ) as { alg: string; kid: string };
    const payload = jwt.decode(token);

    expect(header).toMatchObject({ alg: 'RS256', kid: KEYS.kid });
    expect(payload).toMatchObject({
      iss: 'caquick-identity',
      aud: 'caquick-api',
    });
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it('반증: 다른 키로 검증하면 실패한다', async () => {
    const jwt = await compile();
    const other = generateEphemeralKeyMaterial();

    const token = jwt.sign({ sub: '1', typ: 'access', role: 'USER' });

    expect(() =>
      jwt.verify(token, {
        publicKey: other.publicKeyPem,
        algorithms: ['RS256'],
      }),
    ).toThrow();
  });
});
