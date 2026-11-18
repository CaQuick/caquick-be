import { IsOptional, IsString } from 'class-validator';

export class AdminCompleteOrderPickupInput {
  @IsString()
  orderId!: string;

  @IsOptional()
  @IsString()
  note?: string | null;
}
