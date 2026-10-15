/**
 * 시드 자격증명이 로그인 DTO·생성 정책을 통과하는지 미리 확인한다.
 * 통과 못 하는 값으로 만들어 두면 시드는 성공하는데 로그인은 ValidationPipe에서 전부 거절된다.
 */
import { IsStrongPasswordConstraint } from '@/common/validators/strong-password.validator';
import {
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  USERNAME_PATTERN,
} from '@/features/auth/constants/auth-admin.constants';

/**
 * 로컬 테스트 계정(관리자 admin, 판매자 seed-seller-a·b)의 공통 비밀번호.
 * 시드는 NODE_ENV=production에서 막히고 운영 DB는 외부에 열려 있지 않아, 공개 레포에 있어도 운영 계정이 되지 않는다.
 */
export const SEED_PASSWORD = 'caquick1234!';
export const SEED_ADMIN_USERNAME = 'admin';

export function assertSeedCredential(args: {
  username: string;
  password: string;
}): void {
  const { username } = args;
  if (
    username.length < MIN_USERNAME_LENGTH ||
    username.length > MAX_USERNAME_LENGTH ||
    !USERNAME_PATTERN.test(username)
  ) {
    // 값은 메시지에 싣지 않는다(CodeQL clear-text-logging)
    throw new Error(
      `시드 username 정책 위반: ${MIN_USERNAME_LENGTH}~${MAX_USERNAME_LENGTH}자, 영문 대소문자·숫자·._- 만 허용`,
    );
  }
  if (!new IsStrongPasswordConstraint().validate(args.password)) {
    throw new Error(
      '시드 password 정책 위반: 8~64자, 알파벳·숫자·특수문자 각 1개 이상',
    );
  }
}
