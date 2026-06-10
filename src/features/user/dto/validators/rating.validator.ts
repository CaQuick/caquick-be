import type {
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Validate, ValidatorConstraint } from 'class-validator';

/**
 * 리뷰 별점 검증: 1.0~5.0, 0.5 단위.
 *
 * 왜: WriteReview 의 rating 필드 룰. SDL Float! 형식만으로는 범위/스텝
 * 제약을 표현할 수 없어 데코레이터로 도메인 규칙을 명시.
 */
@ValidatorConstraint({ name: 'IsRatingValid', async: false })
export class IsRatingValidConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'number') return false;
    if (!Number.isFinite(value)) return false;
    if (value < 1 || value > 5) return false;
    // 0.5 단위: value * 2 가 정수여야 함
    return Number.isInteger(value * 2);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be 1.0~5.0 in 0.5 steps.`;
  }
}

export function IsRatingValid(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return Validate(IsRatingValidConstraint, [], validationOptions);
}
