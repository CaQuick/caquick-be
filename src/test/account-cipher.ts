import { randomBytes } from 'node:crypto';

import type { AccountCryptoKey } from '@/config/account-crypto.config';
import { AccountCipher } from '@/global/crypto/account-cipher.service';

/** 테스트 키는 실행마다 만든다 — 운영·개발 키를 테스트에 두지 않는다. */
export function testAccountKey(id = 'test'): AccountCryptoKey {
  return { id, key: randomBytes(32) };
}

export function createTestAccountCipher(): AccountCipher {
  return new AccountCipher({ keys: [testAccountKey()] });
}
