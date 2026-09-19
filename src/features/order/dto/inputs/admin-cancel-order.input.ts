import { IsString, MaxLength } from 'class-validator';

import { MAX_ADMIN_CANCEL_NOTE_LENGTH } from '@/features/order/constants/order-admin.constants';

export class AdminCancelOrderInput {
  @IsString()
  orderId!: string;

  @IsString()
  @MaxLength(MAX_ADMIN_CANCEL_NOTE_LENGTH)
  note!: string;
}
