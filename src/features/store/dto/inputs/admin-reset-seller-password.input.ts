import { IsString } from 'class-validator';

import { IsInitialPassword } from '@/common/validators/initial-password.validator';

export class AdminResetSellerPasswordInput {
  @IsString()
  accountId!: string;

  @IsInitialPassword()
  newPassword!: string;
}
