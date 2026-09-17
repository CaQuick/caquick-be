export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    isRecord(v) && Object.values(v).every((val) => typeof val === 'string')
  );
}
