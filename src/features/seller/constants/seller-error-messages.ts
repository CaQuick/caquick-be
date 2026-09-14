/**
 * 판매자 동적 에러 메시지.
 *
 * 정적 문구는 전부 common/errors 카탈로그로 옮겼다. 필드명·범위가 런타임 값이라
 * 카탈로그의 고정 문자열로 표현할 수 없는 것만 여기 남는다.
 */

// ── 동적 에러 메시지 헬퍼 ──

export function fieldRangeError(
  field: string,
  min: number,
  max: number,
): string {
  return `${field}은(는) ${min.toString()}~${max.toString()} 사이여야 합니다.`;
}

export function idsMismatchError(field: string): string {
  return `${field} 개수가 맞지 않습니다.`;
}

export function invalidIdsError(field: string): string {
  return `${field}에 올바르지 않은 값이 있습니다.`;
}
