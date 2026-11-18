import { randomBytes } from 'node:crypto';

import accountCryptoConfig, {
  parseAccountEncryptionKeys,
  readAccountCryptoConfig,
} from '@/config/account-crypto.config';

const b64 = (bytes: number) => randomBytes(bytes).toString('base64');

describe('accountCryptoConfig', () => {
  const k1 = b64(32);
  const k2 = b64(32);

  it('키를 적힌 순서대로 읽는다(첫 키가 암호화 키), 공백·빈 항목은 무시한다', () => {
    const keys = parseAccountEncryptionKeys(` k2:${k2} , k1:${k1} ,`);
    expect(keys.map((k) => k.id)).toEqual(['k2', 'k1']);
    expect(keys[0].key.equals(Buffer.from(k2, 'base64'))).toBe(true);
    expect(keys[1].key).toHaveLength(32);
  });

  it('base64url 문자도 받는다', () => {
    const key = randomBytes(32);
    expect(
      parseAccountEncryptionKeys(`k1:${key.toString('base64url')}`)[0].key,
    ).toEqual(key);
  });

  // 반증 — 운영 부팅을 막아야 하는 형식 오류 전수
  const malformed: Array<[string, string]> = [
    ['빈 목록', ' , '],
    ['콜론 없음', `k1${k1}`],
    ['빈 keyId', `:${k1}`],
    ['keyId에 점', `k.1:${k1}`],
    ['keyId 33자', `${'k'.repeat(33)}:${k1}`],
    ['31바이트 키', `k1:${b64(31)}`],
    ['33바이트 키', `k1:${b64(33)}`],
    ['base64 밖 문자', `k1:${k1.slice(0, -2)}!=`],
    ['키 없음', 'k1:'],
    ['keyId 중복', `k1:${k1},k1:${k2}`],
  ];

  it.each(malformed)('반증: %s면 production 부팅에서 던진다', (_label, raw) => {
    expect(() =>
      readAccountCryptoConfig({
        NODE_ENV: 'production',
        ACCOUNT_ENCRYPTION_KEYS: raw,
      }),
    ).toThrow('ACCOUNT_ENCRYPTION_KEYS is malformed');
  });

  it.each(malformed)(
    '%s면 비운영은 고정 개발 키로 대신하고 이유를 남긴다',
    (_label, raw) => {
      const config = readAccountCryptoConfig({
        NODE_ENV: 'development',
        ACCOUNT_ENCRYPTION_KEYS: raw,
      });
      expect(config.keys.map((k) => k.id)).toEqual(['dev']);
      expect(config.devKeyReason).toContain('형식 오류');
    },
  );

  it('형식 오류 메시지에 키 값을 싣지 않는다', () => {
    const secret = b64(31);
    let message = '';
    try {
      readAccountCryptoConfig({
        NODE_ENV: 'production',
        ACCOUNT_ENCRYPTION_KEYS: `k1:${secret}`,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('entry 1 (k1)');
    expect(message).not.toContain(secret);
  });

  it('반증: production에서 키가 없거나 공백뿐이면 부팅에서 던진다', () => {
    for (const raw of [undefined, '   ']) {
      expect(() =>
        readAccountCryptoConfig({
          NODE_ENV: 'production',
          ACCOUNT_ENCRYPTION_KEYS: raw,
        }),
      ).toThrow('ACCOUNT_ENCRYPTION_KEYS must be set');
    }
  });

  it('production에서 올바른 키면 그대로 쓴다', () => {
    const config = readAccountCryptoConfig({
      NODE_ENV: 'production',
      ACCOUNT_ENCRYPTION_KEYS: `k1:${k1}`,
    });
    expect(config.devKeyReason).toBeNull();
    expect(config.keys.map((k) => k.id)).toEqual(['k1']);
  });

  it('비운영에서 키가 없으면 매번 같은 32바이트 개발 키를 쓴다(로컬 재시작 뒤에도 풀린다)', () => {
    const a = readAccountCryptoConfig({});
    const b = readAccountCryptoConfig({ NODE_ENV: 'test' });
    expect(a.devKeyReason).toBe('ACCOUNT_ENCRYPTION_KEYS 미설정');
    expect(a.keys[0].key).toHaveLength(32);
    expect(a.keys[0].key.equals(b.keys[0].key)).toBe(true);
  });

  it('registerAs는 process.env를 같은 규칙으로 읽는다', () => {
    const saved = process.env.ACCOUNT_ENCRYPTION_KEYS;
    process.env.ACCOUNT_ENCRYPTION_KEYS = `k9:${k1}`;
    try {
      expect(accountCryptoConfig().keys.map((k) => k.id)).toEqual(['k9']);
    } finally {
      if (saved === undefined) delete process.env.ACCOUNT_ENCRYPTION_KEYS;
      else process.env.ACCOUNT_ENCRYPTION_KEYS = saved;
    }
  });
});
