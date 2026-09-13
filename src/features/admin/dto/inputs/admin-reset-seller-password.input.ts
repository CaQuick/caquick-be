import { IsString } from 'class-validator';

import { IsStrongPassword } from '@/common/validators/strong-password.validator';

export class AdminResetSellerPasswordInput {
  @IsString()
  accountId!: string;

  @IsStrongPassword()
  newPassword!: string;
}
