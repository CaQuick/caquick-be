import { IsInt, Min } from 'class-validator';

export class SellerUpdatePickupPolicyInput {
  @IsInt()
  @Min(1)
  pickupSlotIntervalMinutes!: number;

  @IsInt()
  @Min(0)
  minLeadTimeMinutes!: number;

  @IsInt()
  @Min(1)
  maxDaysAhead!: number;
}
