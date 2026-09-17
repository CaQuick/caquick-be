import { IsString, Length } from 'class-validator';

import { IsStrongPassword } from '@/common/validators/strong-password.validator';

/** currentPassword는 argon2.verify가 실제 인증을 담당하므로 형식(8~64)만 본다. newPassword만 강 정책. */
export class ChangePasswordInput {
  @IsString()
  @Length(8, 64)
  currentPassword!: string;

  @IsStrongPassword()
  newPassword!: string;
}
