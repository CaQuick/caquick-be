/**
 * 시드 자격증명이 로그인 DTO·생성 정책을 통과하는지 미리 확인한다.
 * 통과 못 하는 값으로 만들어 두면 시드는 성공하는데 로그인은 ValidationPipe에서 전부 거절된다.
 */
import { IsStrongPasswordConstraint } from '@/common/validators/strong-password.validator';

const USERNAME_PATTERN = /^[a-z0-9._-]{4,80}$/;

export function assertSeedCredential(args: {
  username: string;
  password: string;
}): void {
  if (!USERNAME_PATTERN.test(args.username)) {
    throw new Error(
      `시드 username 정책 위반: 4~80자, 소문자·숫자·._- 만 허용 (${args.username})`,
    );
  }
  if (!new IsStrongPasswordConstraint().validate(args.password)) {
    throw new Error(
      '시드 password 정책 위반: 8~64자, 대문자·소문자·숫자·특수문자 각 1개 이상',
    );
  }
}
