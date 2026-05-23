import { IsString, Length } from 'class-validator';

/**
 * POST /auth/seller/login Body.
 *
 * username 길이 4~50, password 길이 8~64 까지 기본 형식만 검증한다.
 * 실제 인증은 argon2.verify 가 담당. 로그인 시점에는 강 정책(복잡도)을
 * 적용하지 않는다 (사용자 등록 시점의 정책만 신뢰).
 */
export class SellerLoginInput {
  @IsString()
  @Length(4, 50)
  username!: string;

  @IsString()
  @Length(8, 64)
  password!: string;
}
