import { Type } from 'class-transformer';
import { IsOptional, IsString, ValidateNested } from 'class-validator';

import { RefundAccountInput } from '@/features/order/dto/inputs/refund-account.input';

export class CancelMyOrderInput {
  @IsString()
  orderId!: string;

  @IsOptional()
  @IsString()
  note?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => RefundAccountInput)
  refundAccount?: RefundAccountInput | null;
}
