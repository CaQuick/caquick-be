import { IsOptional, IsString, Matches } from 'class-validator';

/** 판매자 앱의 refresh·logout 바디. 없으면 쿠키 모드. 토큰은 generateRandomToken(32)의 hex 64자. */
export class RefreshTokenInput {
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  refreshToken?: string;
}
