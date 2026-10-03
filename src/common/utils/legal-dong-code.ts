/**
 * 법정동·행정동 코드(10자리)의 앞 5자리가 시군구 코드다 — 2차 지역 slug 'sgg-<시군구코드>'와 같은 체계.
 * 형식이 다르거나 시·도 단위 코드(xx000…)면 null.
 */
export function sigunguCodeOf(code: unknown): string | null {
  if (typeof code !== 'string' || !/^\d{10}$/.test(code)) return null;
  return code.slice(2, 5) === '000' ? null : code.slice(0, 5);
}

export function districtSlugOf(sigunguCode: string): string {
  return `sgg-${sigunguCode}`;
}
