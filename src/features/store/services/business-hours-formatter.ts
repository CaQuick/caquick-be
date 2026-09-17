const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

interface BusinessHourRow {
  day_of_week: number; // 0=일 ~ 6=토
  is_closed: boolean;
  open_time: Date | null;
  close_time: Date | null;
}

/** Prisma의 Time 타입은 Date 객체로 반환되며 시/분만 의미가 있다. */
function formatTime(date: Date): string {
  const h = date.getUTCHours().toString().padStart(2, '0');
  const m = date.getUTCMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

/** 예: "매일 09:00 ~ 18:00 / 화요일 정기 휴무", "월~금 09:00 ~ 18:00, 토 10:00 ~ 17:00 / 일요일 정기 휴무". */
export function formatBusinessHours(
  hours: BusinessHourRow[],
  fallback?: string | null,
): string | null {
  if (hours.length === 0) {
    return fallback ?? null;
  }

  const sorted = [...hours].sort((a, b) => a.day_of_week - b.day_of_week);

  const closedDays: string[] = [];
  const openSlots: { dayOfWeek: number; timeRange: string }[] = [];

  for (const h of sorted) {
    if (h.is_closed) {
      closedDays.push(`${DAY_LABELS[h.day_of_week]}요일`);
    } else if (h.open_time && h.close_time) {
      openSlots.push({
        dayOfWeek: h.day_of_week,
        timeRange: `${formatTime(h.open_time)} ~ ${formatTime(h.close_time)}`,
      });
    }
  }

  const groups = groupByTimeRange(openSlots);
  const parts: string[] = [];

  for (const group of groups) {
    const dayLabel = formatDayRange(group.days);
    parts.push(`${dayLabel} ${group.timeRange}`);
  }

  if (closedDays.length > 0) {
    parts.push(`${closedDays.join(', ')} 정기 휴무`);
  }

  return parts.length > 0 ? parts.join(' / ') : (fallback ?? null);
}

function groupByTimeRange(
  slots: { dayOfWeek: number; timeRange: string }[],
): { days: number[]; timeRange: string }[] {
  const groups: { days: number[]; timeRange: string }[] = [];

  for (const slot of slots) {
    const existing = groups.find((g) => g.timeRange === slot.timeRange);
    if (existing) {
      existing.days.push(slot.dayOfWeek);
    } else {
      groups.push({ days: [slot.dayOfWeek], timeRange: slot.timeRange });
    }
  }

  return groups;
}

function formatDayRange(days: number[]): string {
  if (days.length === 7) return '매일';
  if (days.length === 0) return '';

  const sorted = [...days].sort((a, b) => a - b);
  if (isConsecutive(sorted) && sorted.length > 2) {
    return `${DAY_LABELS[sorted[0]]}~${DAY_LABELS[sorted[sorted.length - 1]]}`;
  }

  return sorted.map((d) => DAY_LABELS[d]).join(', ');
}

function isConsecutive(sortedDays: number[]): boolean {
  for (let i = 1; i < sortedDays.length; i++) {
    if (sortedDays[i] !== sortedDays[i - 1] + 1) return false;
  }
  return true;
}
