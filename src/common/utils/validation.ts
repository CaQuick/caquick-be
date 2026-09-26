import { isRecord, isStringRecord } from '@/common/utils/type-guards';

type ValidationErrorLike = {
  property: string;
  constraints?: Record<string, string>;
};

export function isValidationErrorLike(v: unknown): v is ValidationErrorLike {
  return (
    isRecord(v) &&
    typeof (v as { property?: unknown }).property === 'string' &&
    ((v as { constraints?: unknown }).constraints === undefined ||
      isStringRecord((v as { constraints?: unknown }).constraints))
  );
}

export function formatValidationError(e: ValidationErrorLike): {
  property: string;
  constraints: Record<string, string>;
} {
  return { property: e.property, constraints: e.constraints ?? {} };
}
