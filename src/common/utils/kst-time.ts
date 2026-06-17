/**
 * KST(Asia/Seoul, UTC+9) 기준 날짜/시간 유틸.
 *
 * 서버 타임존과 무관하게 동작하도록, 내부적으로 UTC epoch에 +9h 오프셋을 적용해
 * KST 달력값을 계산한다. 모든 함수는 순수 함수(입력 Date만 사용)이며, "현재 시각"이
 * 필요한 호출부는 now를 주입해 결정적으로 테스트한다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

export interface KstYmd {
  year: number;
  month: number; // 1-12
  day: number;
}

/** UTC Date를 KST 기준 연/월/일로 분해한다. */
export function toKstYmd(date: Date): KstYmd {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    year: kst.getUTCFullYear(),
    month: kst.getUTCMonth() + 1,
    day: kst.getUTCDate(),
  };
}

/** KST 기준 (year, month, day) 자정에 해당하는 UTC Date. month는 1-12. */
export function kstMidnightUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - KST_OFFSET_MS);
}

/** KST 기준 "YYYY-MM-DD" 문자열. */
export function formatKstDate(date: Date): string {
  const { year, month, day } = toKstYmd(date);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** KST 기준 자정부터의 경과 분(0-1439). */
export function kstMinutesOfDay(date: Date): number {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

/** "YYYY-MM" 파싱. 형식/범위 오류 시 null. */
export function parseKstYearMonth(
  value: string,
): { year: number; month: number } | null {
  const matched = /^(\d{4})-(\d{2})$/.exec(value);
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** "YYYY-MM-DD"(KST)를 그 날 00:00 KST에 해당하는 UTC Date로 변환. 잘못된 날짜는 null. */
export function parseKstDate(value: string): Date | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = kstMidnightUtc(year, month, day);
  // 존재하지 않는 날짜(예: 2026-02-30)는 정규화되며 입력과 불일치 → 거부
  if (formatKstDate(date) !== value) return null;
  return date;
}

/** KST 자정 기준 (b 날짜 - a 날짜) 일수. 같은 날 0. */
export function kstDayDiff(a: Date, b: Date): number {
  const startA = parseKstDate(formatKstDate(a));
  const startB = parseKstDate(formatKstDate(b));
  if (!startA || !startB) return 0;
  return Math.round((startB.getTime() - startA.getTime()) / DAY_MS);
}

/** 자정 경과 분(0-1439)을 "HH:MM"으로 포맷. */
export function formatMinutesOfDay(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${pad2(hours)}:${pad2(mins)}`;
}
