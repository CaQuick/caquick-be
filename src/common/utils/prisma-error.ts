import { isRecord } from '@/common/utils/type-guards';

/**
 * P2002(unique 제약 위반)이 **어느 제약**에서 났는지 이름을 뽑는다.
 *
 * 왜 필요한가: 한 테이블에 unique가 둘 이상이면 P2002만으로는 대응이 갈린다.
 * 예를 들어 주문 생성은 order_number 충돌이면 번호를 바꿔 재시도하고, 멱등 키
 * 충돌이면 기존 주문을 replay 해야 한다. 코드만 보면 둘을 구분할 수 없다.
 *
 * 왜 두 형식인가: Prisma 7이 드라이버 어댑터 경로로 오면서 제약 이름이
 * `meta.target`이 아니라 `meta.driverAdapterError.cause.constraint`로 옮겨갔다.
 * 엔진 경로(구버전)와 어댑터 경로를 모두 읽어 두면 버전·드라이버 교체에 흔들리지 않는다.
 *
 * @returns 제약 이름(배열이면 `,`로 join), 알 수 없으면 null
 */
export function uniqueConstraintNameOf(error: unknown): string | null {
  if (!isRecord(error)) return null;

  const meta = error.meta;
  if (!isRecord(meta)) return null;

  // Prisma 7 드라이버 어댑터 경로
  const adapterError = meta.driverAdapterError;
  if (isRecord(adapterError)) {
    const cause = adapterError.cause;
    if (isRecord(cause)) {
      const constraint = cause.constraint;
      if (isRecord(constraint)) {
        const name =
          normalizeName(constraint.index) ?? normalizeName(constraint.fields);
        if (name) return name;
      }
      const name = normalizeName(constraint);
      if (name) return name;
    }
  }

  // Prisma 6 엔진 경로 (MySQL은 문자열, 일부 커넥터는 컬럼 배열)
  return normalizeName(meta.target);
}

function normalizeName(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.length > 0 ? value : null;
  }
  if (Array.isArray(value)) {
    const parts = value.filter((v): v is string => typeof v === 'string');
    return parts.length > 0 ? parts.join(',') : null;
  }
  return null;
}

/** 제약 이름에 주어진 조각이 들어 있는지 (이름을 모르면 false) */
export function isUniqueConstraintOn(
  error: unknown,
  fragment: string,
): boolean {
  return uniqueConstraintNameOf(error)?.includes(fragment) ?? false;
}
