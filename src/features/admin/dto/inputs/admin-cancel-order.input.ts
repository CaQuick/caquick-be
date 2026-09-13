import { IsString, MaxLength } from 'class-validator';

import { MAX_REASON_LENGTH } from '@/features/admin/constants/admin.constants';

export class AdminCancelOrderInput {
  @IsString()
  orderId!: string;

  @IsString()
  @MaxLength(MAX_REASON_LENGTH)
  note!: string;
}
