import { createHash, randomBytes } from 'node:crypto';

export function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function generateRandomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}
