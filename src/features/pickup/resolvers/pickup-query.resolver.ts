import { Args, Query, Resolver } from '@nestjs/graphql';

import { PickupSlotService } from '@/features/pickup/services/pickup-slot.service';
import type {
  PickupCalendar,
  PickupTimeSlots,
} from '@/features/pickup/types/pickup-output.type';

/**
 * 홈 픽업 슬롯 조회 resolver. 비로그인도 접근 가능한 public query.
 */
@Resolver('Query')
export class PickupQueryResolver {
  constructor(private readonly pickupSlotService: PickupSlotService) {}

  @Query('pickupCalendar')
  pickupCalendar(@Args('yearMonth') yearMonth: string): PickupCalendar {
    return this.pickupSlotService.pickupCalendar(yearMonth);
  }

  @Query('pickupTimeSlots')
  pickupTimeSlots(@Args('date') date: string): PickupTimeSlots {
    return this.pickupSlotService.pickupTimeSlots(date);
  }
}
