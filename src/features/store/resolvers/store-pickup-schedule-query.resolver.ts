import { Args, Query, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { StorePickupScheduleService } from '@/features/store/services/store-pickup-schedule.service';
import type {
  PickupCalendar,
  PickupTimeSlots,
} from '@/features/store/types/pickup-schedule-output.type';

/**
 * 매장별 픽업 달력·시간 슬롯 resolver. 비로그인도 접근 가능한 public query.
 */
@Resolver('Query')
export class StorePickupScheduleQueryResolver {
  constructor(private readonly service: StorePickupScheduleService) {}

  @Query('pickupCalendar')
  pickupCalendar(
    @Args('storeId') storeId: string,
    @Args('yearMonth') yearMonth: string,
  ): Promise<PickupCalendar> {
    return this.service.pickupCalendar(parseId(storeId), yearMonth);
  }

  @Query('pickupTimeSlots')
  pickupTimeSlots(
    @Args('storeId') storeId: string,
    @Args('date') date: string,
  ): Promise<PickupTimeSlots> {
    return this.service.pickupTimeSlots(parseId(storeId), date);
  }
}
