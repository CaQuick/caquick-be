/**
 * 객체(레코드)인지 체크
 */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * { [k: string]: string } 형태인지 체크
 */
export function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    isRecord(v) && Object.values(v).every((val) => typeof val === 'string')
  );
}
