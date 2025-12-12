import { isRecord, isStringRecord } from 'src/common/utils/type-guards';

/**
 * class-validator ValidationError와 호환되는 형태
 */
type ValidationErrorLike = {
  property: string;
  constraints?: Record<string, string>;
};

/**
 * ValidationError-like 타입가드 (런타임 안전)
 */
export function isValidationErrorLike(v: unknown): v is ValidationErrorLike {
  return (
    isRecord(v) &&
    typeof (v as { property?: unknown }).property === 'string' &&
    ((v as { constraints?: unknown }).constraints === undefined ||
      isStringRecord((v as { constraints?: unknown }).constraints))
  );
}

/**
 * API 응답용 포맷으로 변환
 */
export function formatValidationError(e: ValidationErrorLike): {
  property: string;
  constraints: Record<string, string>;
} {
  return { property: e.property, constraints: e.constraints ?? {} };
}
