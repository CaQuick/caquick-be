import { IsString, Length } from 'class-validator';

import { IsStrongPassword } from '@/common/validators/strong-password.validator';

/**
 * POST /auth/seller/change-password Body.
 *
 * currentPassword: 기존 비밀번호. argon2.verify 가 실제 인증을 담당하므로
 * 형식 검증만 (8~64 길이). 강 정책은 적용하지 않는다.
 * newPassword: 강 비밀번호 정책 적용 (길이 + 복잡도 4종).
 */
export class SellerChangePasswordInput {
  @IsString()
  @Length(8, 64)
  currentPassword!: string;

  @IsStrongPassword()
  newPassword!: string;
}
