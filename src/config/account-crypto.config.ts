import { createHash } from 'node:crypto';

import { registerAs } from '@nestjs/config';

import { parseEnvList, parseEnvString } from '@/common/utils/env-parse';

export interface AccountCryptoKey {
  id: string;
  key: Buffer;
}

export interface AccountCryptoConfig {
  /** 첫 키로 암호화하고 토큰에 적힌 keyId로 복호화한다. 회전 중에는 옛 키를 뒤에 남긴다. */
  keys: AccountCryptoKey[];
  /** 비운영에서 고정 개발 키로 대신한 이유. 설정한 키를 쓰면 null. */
  devKeyReason: string | null;
}

// keyId는 토큰 구분자(.)와 env 구분자(: ,)를 쓰지 못한다
const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;
const BASE64 = /^[A-Za-z0-9+/_-]+={0,2}$/;
const KEY_BYTES = 32;

/** 로컬·테스트 전용. production은 키가 없으면 부팅하지 않아 운영 데이터가 이 키로 암호화되지 않는다. */
const DEV_KEY: AccountCryptoKey = {
  id: 'dev',
  key: createHash('sha256').update('caquick-local-account-key').digest(),
};

/** `k2:<base64 32B>,k1:<base64 32B>`. 오류 메시지에 키 값을 싣지 않는다. */
export function parseAccountEncryptionKeys(raw: string): AccountCryptoKey[] {
  const entries = parseEnvList(raw);
  if (entries.length === 0) throw new Error('no keys');
  const keys = entries.map((entry, index) => {
    const sep = entry.indexOf(':');
    const id = sep < 0 ? '' : entry.slice(0, sep);
    if (!KEY_ID.test(id)) {
      throw new Error(`entry ${index + 1}: keyId must match ${KEY_ID.source}`);
    }
    const encoded = entry.slice(sep + 1);
    if (
      !BASE64.test(encoded) ||
      Buffer.from(encoded, 'base64').length !== KEY_BYTES
    ) {
      throw new Error(
        `entry ${index + 1} (${id}): key must be base64 32 bytes`,
      );
    }
    return { id, key: Buffer.from(encoded, 'base64') };
  });
  if (new Set(keys.map((k) => k.id)).size !== keys.length) {
    throw new Error('duplicate keyId');
  }
  return keys;
}

/** registerAs와 DI 밖(재암호화 스크립트·시드)이 같은 규칙으로 읽도록 순수 함수로 둔다. */
export function readAccountCryptoConfig(
  env: NodeJS.ProcessEnv = process.env,
): AccountCryptoConfig {
  const isProd = env.NODE_ENV === 'production';
  const raw = parseEnvString(env.ACCOUNT_ENCRYPTION_KEYS);
  if (raw === undefined) {
    if (isProd) {
      throw new Error(
        'ACCOUNT_ENCRYPTION_KEYS must be set in production environment',
      );
    }
    return { keys: [DEV_KEY], devKeyReason: 'ACCOUNT_ENCRYPTION_KEYS 미설정' };
  }
  try {
    return { keys: parseAccountEncryptionKeys(raw), devKeyReason: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (isProd) {
      throw new Error(`ACCOUNT_ENCRYPTION_KEYS is malformed: ${reason}`);
    }
    return {
      keys: [DEV_KEY],
      devKeyReason: `ACCOUNT_ENCRYPTION_KEYS 형식 오류(${reason})`,
    };
  }
}

export default registerAs('accountCrypto', (): AccountCryptoConfig =>
  readAccountCryptoConfig(),
);
