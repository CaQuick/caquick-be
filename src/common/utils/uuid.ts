import { createHash } from 'node:crypto';

/**
 * RFC 4122 v5(SHA-1 이름 기반) UUID. 같은 (namespace, name)은 항상 같은 값 —
 * 멱등 키를 outbox event_id(unique)로 바꿔 재요청을 거부·재생하는 데 쓴다.
 */
export function uuidV5(namespaceUuid: string, name: string): string {
  const namespace = Buffer.from(namespaceUuid.replace(/-/g, ''), 'hex');
  if (namespace.length !== 16) {
    throw new Error(`namespace가 UUID가 아닙니다: ${namespaceUuid}`);
  }
  const hash = createHash('sha1')
    .update(Buffer.concat([namespace, Buffer.from(name, 'utf8')]))
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
