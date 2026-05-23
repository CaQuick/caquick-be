import { IsString, Matches } from 'class-validator';

/**
 * POST /auth/dev/issue-token Body (개발 환경 한정).
 *
 * accountId 는 BigInt 호환 숫자 문자열. 부호/소수 불허.
 */
export class DevIssueTokenInput {
  @IsString()
  @Matches(/^\d+$/, { message: 'accountId must be a numeric string.' })
  accountId!: string;
}
