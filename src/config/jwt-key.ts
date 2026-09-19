import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';
import { readFileSync } from 'node:fs';

/** JWKS로 공개할 RSA 공개키 1벌. */
export interface JwtPublicJwk {
  kty: 'RSA';
  n: string;
  e: string;
  alg: 'RS256';
  use: 'sig';
  kid: string;
}

export interface JwtKeyMaterial {
  privateKeyPem: string;
  publicKeyPem: string;
  /** RFC 7638 썸프린트 — 키를 바꾸면 자동으로 바뀐다(수동 관리 불필요). */
  kid: string;
  publicJwk: JwtPublicJwk;
}

/** base64로 싣거나(`*_PEM_B64`) 파일 경로로 가리킨다(`*_KEY_PATH`). 둘 다 없으면 undefined. */
export function readPem(args: {
  base64?: string;
  path?: string;
}): string | undefined {
  const base64 = args.base64?.trim();
  if (base64) return Buffer.from(base64, 'base64').toString('utf8').trim();
  const path = args.path?.trim();
  if (path) return readFileSync(path, 'utf8').trim();
  return undefined;
}

/**
 * RFC 7638 JWK 썸프린트 — 필수 멤버만 사전순으로 담은 JSON의 SHA-256을 base64url로.
 * RSA의 필수 멤버는 e·kty·n이다.
 */
export function rfc7638Thumbprint(jwk: { e: string; n: string }): string {
  const canonical = JSON.stringify({ e: jwk.e, kty: 'RSA', n: jwk.n });
  return createHash('sha256').update(canonical).digest('base64url');
}

function toPublicJwk(publicKey: KeyObject): Omit<JwtPublicJwk, 'kid'> & {
  kid: string;
} {
  const jwk = publicKey.export({ format: 'jwk' }) as {
    kty?: string;
    n?: string;
    e?: string;
  };
  if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) {
    throw new Error('JWT 키는 RSA여야 합니다');
  }
  return {
    kty: 'RSA',
    n: jwk.n,
    e: jwk.e,
    alg: 'RS256',
    use: 'sig',
    kid: rfc7638Thumbprint({ e: jwk.e, n: jwk.n }),
  };
}

/** 공개키를 주지 않으면 개인키에서 유도한다(운영에서 둘 중 하나만 넣어도 되게). */
export function buildKeyMaterial(args: {
  privateKeyPem: string;
  publicKeyPem?: string;
}): JwtKeyMaterial {
  const publicKey = args.publicKeyPem
    ? createPublicKey(args.publicKeyPem)
    : createPublicKey(args.privateKeyPem);
  const publicJwk = toPublicJwk(publicKey);
  return {
    // 어디서 왔든(환경변수·파일·즉석 생성) 같은 형태로 다듬어 비교·저장이 흔들리지 않게 한다
    privateKeyPem: args.privateKeyPem.trim(),
    publicKeyPem: publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString()
      .trim(),
    kid: publicJwk.kid,
    publicJwk,
  };
}

/**
 * 키가 설정되지 않은 로컬·테스트용 임시 키. 프로세스가 재시작되면 바뀌므로 발급된 토큰은 무효가 된다 —
 * 운영에서는 설정을 강제한다(auth.config).
 */
export function generateEphemeralKeyMaterial(): JwtKeyMaterial {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  return buildKeyMaterial({
    privateKeyPem: privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  });
}
