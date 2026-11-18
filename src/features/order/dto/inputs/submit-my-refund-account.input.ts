import { IsString } from 'class-validator';

import { RefundAccountInput } from '@/features/order/dto/inputs/refund-account.input';

export class SubmitMyRefundAccountInput extends RefundAccountInput {
  @IsString()
  refundId!: string;
}
