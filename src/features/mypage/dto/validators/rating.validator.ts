import type {
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Validate, ValidatorConstraint } from 'class-validator';

/** 1.0~5.0, 0.5 단위 — SDL Float!만으로는 범위/스텝을 표현할 수 없다. */
@ValidatorConstraint({ name: 'IsRatingValid', async: false })
export class IsRatingValidConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'number') return false;
    if (!Number.isFinite(value)) return false;
    if (value < 1 || value > 5) return false;
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
