import type {
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Validate, ValidatorConstraint } from 'class-validator';

/**
 * 강력한 비밀번호 정책 검증.
 *
 * 왜: 판매자·관리자 비밀번호 설정에서 길이 8~64 + 소문자/대문자/숫자/특수문자
 * 4종 포함을 요구한다. 기존 auth.service.assertStrongPassword 의 로직을
 * 그대로 옮겨와 DTO 레이어에서 일원화.
 *
 * 길이는 입력 원문(raw) 기준이다 — 저장되는 값도 원문이고 로그인 DTO(CredentialLoginInput)도
 * 원문 길이 8~64를 보므로, trim 기준으로 통과시키면 로그인이 거절되는 비밀번호가 만들어진다.
 */
@ValidatorConstraint({ name: 'IsStrongPassword', async: false })
export class IsStrongPasswordConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const pw = value;
    if (pw.length < 8 || pw.length > 64) return false;
    return (
      /[a-z]/.test(pw) &&
      /[A-Z]/.test(pw) &&
      /[0-9]/.test(pw) &&
      /[^A-Za-z0-9]/.test(pw)
    );
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be 8~64 characters and include lower/upper case, number, and special character.`;
  }
}

export function IsStrongPassword(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return Validate(IsStrongPasswordConstraint, [], validationOptions);
}
