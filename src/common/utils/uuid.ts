import { createHash } from 'node:crypto';

/**
 * 이름 기반 결정적 UUID(RFC 9562 v8, SHA-256 앞 16바이트). 같은 (namespace, name)은 항상 같은 값 —
 * 멱등 키를 outbox event_id(unique)로 바꿔 재요청을 거부·재생하는 데 쓴다. 보안 목적 해시가 아니라
 * 충돌 저항만 필요하지만, v5의 SHA-1은 약한 알고리즘으로 분류되므로 SHA-256을 쓴다.
 */
export function deterministicUuid(namespaceUuid: string, name: string): string {
  const namespace = Buffer.from(namespaceUuid.replace(/-/g, ''), 'hex');
  if (namespace.length !== 16) {
    throw new Error(`namespace가 UUID가 아닙니다: ${namespaceUuid}`);
  }
  const hash = createHash('sha256')
    .update(Buffer.concat([namespace, Buffer.from(name, 'utf8')]))
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x80;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
