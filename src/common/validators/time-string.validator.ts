import type {
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Validate, ValidatorConstraint } from 'class-validator';

/**
 * "HH:MM" (24시간제) 형식 검증.
 *
 * 왜: seller 도메인 영업시간 입력이 HH:MM 문자열로 전달된다.
 * seller-base.service.ts:64 부근의 수동 검증을 데코레이터로 통합.
 */
@ValidatorConstraint({ name: 'IsTimeString', async: false })
export class IsTimeStringConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be HH:MM (00:00 ~ 23:59).`;
  }
}

export function IsTimeString(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return Validate(IsTimeStringConstraint, [], validationOptions);
}
