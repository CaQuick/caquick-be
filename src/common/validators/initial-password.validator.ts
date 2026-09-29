import type {
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  isString,
  length,
  Validate,
  ValidatorConstraint,
} from 'class-validator';

/**
 * 관리자가 지정하는 초기 비밀번호. 최초 로그인 때 변경이 강제되므로 조합 규칙 없이
 * 로그인 DTO(CredentialLoginInput)와 같은 형식만 본다 — 여기서 통과한 값은 반드시 로그인할 수 있어야 한다.
 * 로그인 서비스가 공백뿐인 비밀번호를 거절하므로 여기서도 거절한다.
 */
@ValidatorConstraint({ name: 'IsInitialPassword', async: false })
export class IsInitialPasswordConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isString(value) && length(value, 8, 64) && value.trim() !== '';
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be 8~64 characters and not blank.`;
  }
}

export function IsInitialPassword(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return Validate(IsInitialPasswordConstraint, [], validationOptions);
}
