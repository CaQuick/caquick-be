import { Args, Query, Resolver } from '@nestjs/graphql';

import { parseId } from '@/common/utils/id-parser';
import { StorePickupScheduleService } from '@/features/store/services/store-pickup-schedule.service';
import type {
  StorePickupCalendar,
  StorePickupTimeSlots,
} from '@/features/store/types/store-pickup-schedule-output.type';

/**
 * 매장별 픽업 달력·시간 슬롯 resolver. 비로그인도 접근 가능한 public query.
 */
@Resolver('Query')
export class StorePickupScheduleQueryResolver {
  constructor(private readonly service: StorePickupScheduleService) {}

  @Query('storePickupCalendar')
  storePickupCalendar(
    @Args('storeId') storeId: string,
    @Args('yearMonth') yearMonth: string,
  ): Promise<StorePickupCalendar> {
    return this.service.storePickupCalendar(parseId(storeId), yearMonth);
  }

  @Query('storePickupTimeSlots')
  storePickupTimeSlots(
    @Args('storeId') storeId: string,
    @Args('date') date: string,
  ): Promise<StorePickupTimeSlots> {
    return this.service.storePickupTimeSlots(parseId(storeId), date);
  }
}
