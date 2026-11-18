import { Args, Query, Resolver } from '@nestjs/graphql';

import { parseId, parseOptionalId } from '@/common/utils/id-parser';
import { StorePickupScheduleService } from '@/features/store/services/store-pickup-schedule.service';
import type {
  PickupCalendar,
  PickupTimeSlots,
} from '@/features/store/types/pickup-schedule-output.type';

@Resolver('Query')
export class StorePickupScheduleQueryResolver {
  constructor(private readonly service: StorePickupScheduleService) {}

  @Query('pickupCalendar')
  pickupCalendar(
    @Args('storeId') storeId: string,
    @Args('yearMonth') yearMonth: string,
    @Args('productId') productId?: string | null,
  ): Promise<PickupCalendar> {
    return this.service.pickupCalendar(
      parseId(storeId),
      yearMonth,
      parseOptionalId(productId),
    );
  }

  @Query('pickupTimeSlots')
  pickupTimeSlots(
    @Args('storeId') storeId: string,
    @Args('date') date: string,
    @Args('productId') productId?: string | null,
  ): Promise<PickupTimeSlots> {
    return this.service.pickupTimeSlots(
      parseId(storeId),
      date,
      parseOptionalId(productId),
    );
  }
}
