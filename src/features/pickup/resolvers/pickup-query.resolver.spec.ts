import { PickupQueryResolver } from '@/features/pickup/resolvers/pickup-query.resolver';
import { PickupSlotService } from '@/features/pickup/services/pickup-slot.service';

describe('PickupQueryResolver', () => {
  const service = new PickupSlotService();
  const resolver = new PickupQueryResolver(service);

  it('pickupCalendar: 서비스에 위임해 월 달력을 반환한다', () => {
    const result = resolver.pickupCalendar('2026-06');
    expect(result.yearMonth).toBe('2026-06');
    expect(result.days).toHaveLength(30);
  });

  it('pickupTimeSlots: 서비스에 위임해 시간 슬롯을 반환한다', () => {
    const result = resolver.pickupTimeSlots('2026-06-25');
    expect(result.date).toBe('2026-06-25');
    expect(result.morning).toHaveLength(4);
    expect(result.afternoon).toHaveLength(16);
  });
});
