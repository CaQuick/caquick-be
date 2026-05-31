import { createHash, randomBytes } from 'node:crypto';

/**
 * SHA-256 해시를 16진수 문자열로 반환한다.
 *
 * @param raw 원본 문자열
 * @returns SHA-256 해시 (16진수)
 */
export function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * 암호학적으로 안전한 랜덤 토큰을 생성한다.
 *
 * @param bytes 바이트 수 (기본값: 32)
 * @returns 16진수 문자열 토큰
 */
export function generateRandomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}
