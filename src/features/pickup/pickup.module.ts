import { Module } from '@nestjs/common';

import { PickupQueryResolver } from '@/features/pickup/resolvers/pickup-query.resolver';
import { PickupSlotService } from '@/features/pickup/services/pickup-slot.service';

@Module({
  providers: [PickupSlotService, PickupQueryResolver],
})
export class PickupModule {}
