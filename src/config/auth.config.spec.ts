import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import authConfig from '@/config/auth.config';
import {
  generateEphemeralKeyMaterial,
  rfc7638Thumbprint,
} from '@/config/jwt-key';

const ENV_KEYS = [
  'NODE_ENV',
  'JWT_PRIVATE_KEY_PEM_B64',
  'JWT_PUBLIC_KEY_PEM_B64',
  'JWT_PRIVATE_KEY_PATH',
  'JWT_PUBLIC_KEY_PATH',
  'JWT_ISSUER',
  'JWT_AUDIENCE',
] as const;

const KEYS = generateEphemeralKeyMaterial();
const b64 = (pem: string): string =>
  Buffer.from(pem, 'utf8').toString('base64');

describe('authConfig', () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
    {};
  let dir: string;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'auth-config-'));
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    rmSync(dir, { recursive: true, force: true });
  });

  function setEnv(vars: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
    for (const [key, value] of Object.entries(vars)) process.env[key] = value;
  }

  describe('키 로딩', () => {
    it('base64 PEM으로 개인키·공개키를 싣는다', () => {
      setEnv({
        JWT_PRIVATE_KEY_PEM_B64: b64(KEYS.privateKeyPem),
        JWT_PUBLIC_KEY_PEM_B64: b64(KEYS.publicKeyPem),
      });

      const { jwtKeys } = authConfig();

      expect(jwtKeys.privateKeyPem).toBe(KEYS.privateKeyPem);
      expect(jwtKeys.publicKeyPem).toBe(KEYS.publicKeyPem);
    });

    it('파일 경로로도 싣는다', () => {
      const path = join(dir, 'private.pem');
      writeFileSync(path, KEYS.privateKeyPem);
      setEnv({ JWT_PRIVATE_KEY_PATH: path });

      expect(authConfig().jwtKeys.privateKeyPem).toBe(KEYS.privateKeyPem);
    });

    it('공개키를 주지 않으면 개인키에서 유도한다', () => {
      setEnv({ JWT_PRIVATE_KEY_PEM_B64: b64(KEYS.privateKeyPem) });

      expect(authConfig().jwtKeys.publicKeyPem).toBe(KEYS.publicKeyPem);
    });

    it('base64가 파일 경로보다 우선한다', () => {
      const other = generateEphemeralKeyMaterial();
      const path = join(dir, 'private.pem');
      writeFileSync(path, other.privateKeyPem);
      setEnv({
        JWT_PRIVATE_KEY_PEM_B64: b64(KEYS.privateKeyPem),
        JWT_PRIVATE_KEY_PATH: path,
      });

      expect(authConfig().jwtKeys.privateKeyPem).toBe(KEYS.privateKeyPem);
    });
  });

  describe('kid', () => {
    it('RFC 7638 썸프린트이고 같은 키면 항상 같다', () => {
      setEnv({ JWT_PRIVATE_KEY_PEM_B64: b64(KEYS.privateKeyPem) });

      const { jwtKeys } = authConfig();

      expect(jwtKeys.kid).toBe(
        rfc7638Thumbprint({ e: jwtKeys.publicJwk.e, n: jwtKeys.publicJwk.n }),
      );
      expect(jwtKeys.kid).toBe(KEYS.kid);
      expect(jwtKeys.publicJwk).toMatchObject({
        kty: 'RSA',
        alg: 'RS256',
        use: 'sig',
        kid: KEYS.kid,
      });
    });

    it('반증: 키가 다르면 kid도 다르다', () => {
      const other = generateEphemeralKeyMaterial();
      expect(other.kid).not.toBe(KEYS.kid);
    });
  });

  describe('미설정', () => {
    it('production이면 부팅을 막는다', () => {
      setEnv({ NODE_ENV: 'production' });

      expect(() => authConfig()).toThrow(
        'JWT_PRIVATE_KEY_PEM_B64 or JWT_PRIVATE_KEY_PATH must be set in production environment',
      );
    });

    it('non-prod면 임시 키를 만든다(재시작하면 바뀐다)', () => {
      setEnv({ NODE_ENV: 'test' });

      const first = authConfig().jwtKeys;
      const second = authConfig().jwtKeys;

      expect(first.privateKeyPem).toContain('PRIVATE KEY');
      expect(second.kid).not.toBe(first.kid);
    });
  });

  describe('iss·aud', () => {
    it('기본값은 caquick-identity·caquick-api이고 env로 덮을 수 있다', () => {
      setEnv({ JWT_PRIVATE_KEY_PEM_B64: b64(KEYS.privateKeyPem) });
      expect(authConfig()).toMatchObject({
        jwtIssuer: 'caquick-identity',
        jwtAudience: 'caquick-api',
      });

      setEnv({ JWT_ISSUER: 'other-issuer', JWT_AUDIENCE: 'other-api' });
      expect(authConfig()).toMatchObject({
        jwtIssuer: 'other-issuer',
        jwtAudience: 'other-api',
      });
    });
  });
});
