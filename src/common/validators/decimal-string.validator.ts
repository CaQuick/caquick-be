import type {
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Validate, ValidatorConstraint } from 'class-validator';

/**
 * 통화/소수 문자열인지 검증한다 (예: "1000", "1000.50", "-12.3").
 *
 * 왜: seller 도메인의 가격/할인 입력이 Prisma `Decimal` 컬럼으로 들어가
 * 부동소수 오차를 피하려고 문자열로 전달된다. seller-base.service.ts:76
 * 부근의 수동 검증을 데코레이터로 통합.
 */
@ValidatorConstraint({ name: 'IsDecimalString', async: false })
export class IsDecimalStringConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return /^-?\d+(\.\d+)?$/.test(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a decimal string (e.g. "1000" or "1000.50").`;
  }
}

export function IsDecimalString(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return Validate(IsDecimalStringConstraint, [], validationOptions);
}
