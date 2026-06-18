import { BadRequestException } from '@nestjs/common';

import { PickupSlotService } from '@/features/pickup/services/pickup-slot.service';

describe('PickupSlotService', () => {
  const service = new PickupSlotService();

  describe('pickupCalendar', () => {
    it('형식 오류면 BadRequestException', () => {
      expect(() => service.pickupCalendar('2026/06')).toThrow(
        BadRequestException,
      );
      expect(() => service.pickupCalendar('2026-13')).toThrow(
        BadRequestException,
      );
    });

    it('월 일수만큼 days를 만들고 과거는 PAST로 막는다', () => {
      const now = new Date('2026-06-18T01:00:00.000Z'); // KST 06-18 10:00
      const calendar = service.pickupCalendar('2026-06', now);

      expect(calendar.yearMonth).toBe('2026-06');
      expect(calendar.days).toHaveLength(30); // 6월은 30일

      const past = calendar.days.find((d) => d.date === '2026-06-17');
      expect(past).toMatchObject({ selectable: false, reason: 'PAST' });

      const today = calendar.days.find((d) => d.date === '2026-06-18');
      expect(today).toMatchObject({ selectable: true, reason: null });
    });

    it('오늘+최대일수(30) 초과는 OUT_OF_RANGE', () => {
      const now = new Date('2026-06-01T01:00:00.000Z'); // KST 06-01
      const calendar = service.pickupCalendar('2026-07', now);

      // 06-01 + 30일 = 07-01 까지 선택 가능, 07-02부터 범위 초과
      expect(
        calendar.days.find((d) => d.date === '2026-07-01')?.selectable,
      ).toBe(true);
      expect(calendar.days.find((d) => d.date === '2026-07-02')).toMatchObject({
        selectable: false,
        reason: 'OUT_OF_RANGE',
      });
    });

    it('오늘이지만 가용 슬롯이 없으면 CLOSED로 막는다', () => {
      // KST 19:00 + 리드 60분 = cutoff 20:00 > 마지막 슬롯 19:30 → 당일 슬롯 없음
      const now = new Date('2026-06-18T10:00:00.000Z'); // KST 06-18 19:00
      const calendar = service.pickupCalendar('2026-06', now);
      expect(calendar.days.find((d) => d.date === '2026-06-18')).toMatchObject({
        selectable: false,
        reason: 'CLOSED',
      });
    });
  });

  describe('pickupTimeSlots', () => {
    it('형식 오류면 BadRequestException', () => {
      expect(() => service.pickupTimeSlots('06-18')).toThrow(
        BadRequestException,
      );
      expect(() => service.pickupTimeSlots('2026-02-30')).toThrow(
        BadRequestException,
      );
    });

    it('미래 날짜는 전 슬롯 available, 오전/오후를 구분한다', () => {
      const now = new Date('2026-06-18T01:00:00.000Z');
      const slots = service.pickupTimeSlots('2026-06-25', now);

      expect(slots.date).toBe('2026-06-25');
      // 오전 10:00,10:30,11:00,11:30 (4), 오후 12:00~19:30 (16)
      expect(slots.morning).toHaveLength(4);
      expect(slots.afternoon).toHaveLength(16);
      expect(slots.morning[0]).toEqual({ time: '10:00', available: true });
      expect(slots.afternoon[0].time).toBe('12:00');
      expect(slots.afternoon.at(-1)?.time).toBe('19:30');
      expect(
        [...slots.morning, ...slots.afternoon].every((s) => s.available),
      ).toBe(true);
    });

    it('당일은 현재시각+리드타임(60분) 이전 슬롯을 마감한다', () => {
      const now = new Date('2026-06-18T04:00:00.000Z'); // KST 13:00 → cutoff 14:00
      const slots = service.pickupTimeSlots('2026-06-18', now);
      const all = [...slots.morning, ...slots.afternoon];

      expect(all.find((s) => s.time === '13:30')?.available).toBe(false);
      expect(all.find((s) => s.time === '14:00')?.available).toBe(true);
    });

    it('과거 날짜는 전 슬롯 마감', () => {
      const now = new Date('2026-06-18T01:00:00.000Z');
      const slots = service.pickupTimeSlots('2026-06-17', now);

      expect(
        [...slots.morning, ...slots.afternoon].every((s) => !s.available),
      ).toBe(true);
    });

    it('범위 초과 날짜는 전 슬롯 마감', () => {
      const now = new Date('2026-06-01T01:00:00.000Z');
      const slots = service.pickupTimeSlots('2026-07-15', now); // +44일

      expect(
        [...slots.morning, ...slots.afternoon].every((s) => !s.available),
      ).toBe(true);
    });
  });
});
