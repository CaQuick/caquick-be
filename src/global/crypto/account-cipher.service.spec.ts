import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { readAccountCryptoConfig } from '@/config/account-crypto.config';
import { AccountCipher } from '@/global/crypto/account-cipher.service';
import { CryptoModule } from '@/global/crypto/crypto.module';
import { CustomLoggerService } from '@/global/logger/custom-logger.service';
import { testAccountKey } from '@/test/account-cipher';

const PLAIN = '110123456789';

describe('AccountCipher', () => {
  const k1 = testAccountKey('k1');
  const k2 = testAccountKey('k2');

  it('암호화한 값을 같은 용도로 풀면 원문이 나온다', () => {
    const cipher = new AccountCipher({ keys: [k1] });
    const token = cipher.encrypt(PLAIN, 'settlement-account');

    expect(token).toMatch(/^v1\.k1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(token).not.toContain(PLAIN);
    expect(cipher.decrypt(token, 'settlement-account')).toBe(PLAIN);
  });

  it('같은 원문도 매번 다른 토큰이 된다(IV 무작위)', () => {
    const cipher = new AccountCipher({ keys: [k1] });
    expect(cipher.encrypt(PLAIN, 'refund-account')).not.toBe(
      cipher.encrypt(PLAIN, 'refund-account'),
    );
  });

  it('키 회전: 새 키를 앞에 두면 새 키로 암호화하고 옛 토큰도 keyId로 푼다', () => {
    const oldToken = new AccountCipher({ keys: [k1] }).encrypt(
      PLAIN,
      'refund-account',
    );
    const rotated = new AccountCipher({ keys: [k2, k1] });
    const newToken = rotated.encrypt(PLAIN, 'refund-account');

    expect(rotated.primaryKeyId).toBe('k2');
    expect(newToken.startsWith('v1.k2.')).toBe(true);
    expect(rotated.decrypt(oldToken, 'refund-account')).toBe(PLAIN);
    expect(rotated.isStale(oldToken)).toBe(true);
    expect(rotated.isStale(newToken)).toBe(false);
  });

  it('반증: 옛 키를 빼면 옛 토큰은 풀리지 않는다', () => {
    const oldToken = new AccountCipher({ keys: [k1] }).encrypt(
      PLAIN,
      'refund-account',
    );
    expect(() =>
      new AccountCipher({ keys: [k2] }).decrypt(oldToken, 'refund-account'),
    ).toThrow('계좌번호 키(k1)가 설정에 없습니다');
  });

  it('반증: 용도(AAD)가 다르면 풀리지 않는다', () => {
    const cipher = new AccountCipher({ keys: [k1] });
    const token = cipher.encrypt(PLAIN, 'refund-account');
    expect(() => cipher.decrypt(token, 'settlement-account')).toThrow(
      '복호화 실패',
    );
  });

  describe('반증: 변조', () => {
    const cipher = new AccountCipher({ keys: [k1, k2] });
    const token = cipher.encrypt(PLAIN, 'settlement-account');
    const parts = token.split('.');
    const flip = (text: string) =>
      (text[0] === 'A' ? 'B' : 'A') + text.slice(1);
    const withPart = (index: number, value: string) =>
      parts.map((p, i) => (i === index ? value : p)).join('.');

    it.each([
      ['암호문', withPart(4, flip(parts[4])), '복호화 실패'],
      ['인증 태그', withPart(3, flip(parts[3])), '복호화 실패'],
      ['IV', withPart(2, flip(parts[2])), '복호화 실패'],
      ['짧은 태그', withPart(3, parts[3].slice(0, 8)), '복호화 실패'],
      ['다른 키의 keyId', withPart(1, 'k2'), '복호화 실패'],
      ['모르는 버전', withPart(0, 'v2'), '형식'],
      ['조각 수', parts.slice(0, 4).join('.'), '형식'],
      ['평문', PLAIN, '형식'],
    ])('%s를 바꾸면 던지고 원문을 싣지 않는다', (_label, tampered, message) => {
      let error: Error | undefined;
      try {
        cipher.decrypt(tampered, 'settlement-account');
      } catch (e) {
        error = e as Error;
      }
      expect(error?.message).toContain(message);
      expect(error?.message).not.toContain(PLAIN);
    });
  });

  it('키가 하나도 없으면 만들 수 없다', () => {
    expect(() => new AccountCipher({ keys: [] })).toThrow('at least one key');
  });
});

describe('CryptoModule', () => {
  async function resolve(env: NodeJS.ProcessEnv) {
    const warn = jest.fn();
    const module = await Test.createTestingModule({
      imports: [
        {
          module: class CryptoDeps {},
          global: true,
          providers: [
            {
              provide: ConfigService,
              useValue: new ConfigService({
                accountCrypto: readAccountCryptoConfig(env),
              }),
            },
            { provide: CustomLoggerService, useValue: { warn } },
          ],
          exports: [ConfigService, CustomLoggerService],
        },
        CryptoModule,
      ],
    }).compile();
    const cipher = module.get(AccountCipher);
    await module.close();
    return { cipher, warn };
  }

  it('설정한 키로 AccountCipher를 만들고 경고하지 않는다', async () => {
    const key = testAccountKey('k7');
    const { cipher, warn } = await resolve({
      ACCOUNT_ENCRYPTION_KEYS: `k7:${key.key.toString('base64')}`,
    });
    expect(cipher.primaryKeyId).toBe('k7');
    expect(warn).not.toHaveBeenCalled();
  });

  it('비운영에서 키가 없으면 개발 키로 만들고 경고한다', async () => {
    const { cipher, warn } = await resolve({});
    expect(cipher.primaryKeyId).toBe('dev');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('고정 개발 키'),
      'AccountCipher',
    );
  });
});
