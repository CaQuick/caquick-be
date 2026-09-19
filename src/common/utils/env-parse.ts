/**
 * 환경변수 문자열 → 값 파싱. `registerAs`(process.env)와 ConfigService 소비처가 같은 규칙을 쓰도록
 * 순수 함수로 한 벌만 둔다. 잘못된 값은 던지지 않고 기본값으로 떨어뜨린다(부팅을 막지 않는 선택 설정용).
 */

export function parseEnvNumber(
  value: string | undefined,
  defaultValue: number,
): number {
  if (!value) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

export function parseEnvBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (!value) return defaultValue;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return defaultValue;
}

/** 공백만 있는 값은 미설정으로 본다. */
export function parseEnvString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/** 쉼표로 나열한 값(예: 허용 오리진 목록). 미설정이면 빈 배열. */
export function parseEnvList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
