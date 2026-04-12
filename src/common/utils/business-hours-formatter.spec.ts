import { formatBusinessHours } from '@/common/utils/business-hours-formatter';

function makeTime(h: number, m: number): Date {
  return new Date(Date.UTC(2000, 0, 1, h, m, 0));
}

function makeHour(
  day: number,
  open: [number, number],
  close: [number, number],
  closed = false,
) {
  return {
    day_of_week: day,
    is_closed: closed,
    open_time: closed ? null : makeTime(open[0], open[1]),
    close_time: closed ? null : makeTime(close[0], close[1]),
  };
}

describe('formatBusinessHours', () => {
  it('모든 요일이 같은 시간이면 "매일 HH:mm ~ HH:mm"을 반환해야 한다', () => {
    const hours = Array.from({ length: 7 }, (_, i) =>
      makeHour(i, [9, 0], [18, 0]),
    );
    expect(formatBusinessHours(hours)).toBe('매일 09:00 ~ 18:00');
  });

  it('일부 요일이 휴무이면 영업시간 + 휴무 정보를 반환해야 한다', () => {
    const hours = [
      makeHour(0, [0, 0], [0, 0], true), // 일 휴무
      makeHour(1, [9, 0], [18, 0]),
      makeHour(2, [9, 0], [18, 0], true), // 화 휴무
      makeHour(3, [9, 0], [18, 0]),
      makeHour(4, [9, 0], [18, 0]),
      makeHour(5, [9, 0], [18, 0]),
      makeHour(6, [9, 0], [18, 0]),
    ];
    const result = formatBusinessHours(hours);
    expect(result).toContain('09:00 ~ 18:00');
    expect(result).toContain('일요일');
    expect(result).toContain('화요일');
    expect(result).toContain('정기 휴무');
  });

  it('요일별로 다른 시간이면 그룹별로 표시해야 한다', () => {
    const hours = [
      makeHour(1, [9, 0], [18, 0]),
      makeHour(2, [9, 0], [18, 0]),
      makeHour(3, [9, 0], [18, 0]),
      makeHour(4, [9, 0], [18, 0]),
      makeHour(5, [9, 0], [18, 0]),
      makeHour(6, [10, 0], [17, 0]),
      makeHour(0, [10, 0], [17, 0]),
    ];
    const result = formatBusinessHours(hours);
    expect(result).toContain('월~금 09:00 ~ 18:00');
    expect(result).toContain('10:00 ~ 17:00');
  });

  it('빈 배열이면 fallback을 반환해야 한다', () => {
    expect(formatBusinessHours([], '매일 09:00 ~ 18:00')).toBe(
      '매일 09:00 ~ 18:00',
    );
  });

  it('빈 배열에 fallback이 없으면 null을 반환해야 한다', () => {
    expect(formatBusinessHours([])).toBeNull();
  });

  it('모든 요일이 휴무이면 휴무만 표시해야 한다', () => {
    const hours = Array.from({ length: 7 }, (_, i) =>
      makeHour(i, [0, 0], [0, 0], true),
    );
    const result = formatBusinessHours(hours);
    expect(result).toContain('정기 휴무');
  });
});
