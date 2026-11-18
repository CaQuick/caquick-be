import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { AccountCryptoConfig } from '@/config/account-crypto.config';

/** AAD로 묶는 용도. 한 용도의 토큰을 다른 용도 칼럼에 옮겨 붙이면 풀리지 않는다. */
export type AccountCipherPurpose = 'refund-account' | 'settlement-account';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

const b64url = (buf: Buffer): string => buf.toString('base64url');
const fromB64url = (text: string): Buffer => Buffer.from(text, 'base64url');

/**
 * 환불·정산 계좌번호 암호화(AES-256-GCM). 토큰 `v1.<keyId>.<iv>.<tag>.<ct>`(b64url)에 keyId가 있어
 * 키를 회전해도 옛 토큰을 풀 수 있다. 실패는 던지되 메시지에 평문·토큰을 싣지 않는다.
 */
export class AccountCipher {
  readonly primaryKeyId: string;
  private readonly keys: ReadonlyMap<string, Buffer>;

  constructor(config: Pick<AccountCryptoConfig, 'keys'>) {
    const [primary] = config.keys;
    if (!primary) throw new Error('AccountCipher needs at least one key');
    this.primaryKeyId = primary.id;
    this.keys = new Map(config.keys.map((k) => [k.id, k.key]));
  }

  encrypt(plain: string, purpose: AccountCipherPurpose): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(
      ALGORITHM,
      this.keys.get(this.primaryKeyId)!,
      iv,
      { authTagLength: TAG_BYTES },
    );
    cipher.setAAD(Buffer.from(purpose));
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [
      VERSION,
      this.primaryKeyId,
      b64url(iv),
      b64url(cipher.getAuthTag()),
      b64url(ct),
    ].join('.');
  }

  decrypt(token: string, purpose: AccountCipherPurpose): string {
    const parts = token.split('.');
    if (parts.length !== 5 || parts[0] !== VERSION) {
      throw new Error('계좌번호 토큰 형식이 아닙니다');
    }
    const [, keyId, iv, tag, ct] = parts;
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`계좌번호 키(${keyId})가 설정에 없습니다`);
    try {
      const decipher = createDecipheriv(ALGORITHM, key, fromB64url(iv), {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(Buffer.from(purpose));
      decipher.setAuthTag(fromB64url(tag));
      return Buffer.concat([
        decipher.update(fromB64url(ct)),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('계좌번호 복호화 실패(용도 불일치 또는 변조)');
    }
  }

  /** 첫 키가 아닌 키로 암호화된 토큰. 키 회전 뒤 재암호화 대상이다. */
  isStale(token: string): boolean {
    return token.split('.')[1] !== this.primaryKeyId;
  }
}
