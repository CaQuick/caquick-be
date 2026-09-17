import { Prisma } from '@/generated/prisma/client';

interface DriverAdapterErrorMeta {
  cause?: { constraint?: { index?: string; fields?: string[] } };
}

/**
 * P2002(unique 충돌)에서 어긋난 제약 이름을 꺼낸다.
 * Prisma 7 드라이버 어댑터 경로는 `meta.target` 대신 `meta.driverAdapterError.cause.constraint`에
 * 담으므로 두 형식을 모두 읽는다. 알 수 없으면 null.
 */
export function uniqueConstraintName(
  error: Prisma.PrismaClientKnownRequestError,
): string | null {
  if (error.code !== 'P2002') return null;
  const meta = error.meta ?? {};
  const target = meta.target;
  if (typeof target === 'string') return target;
  if (Array.isArray(target)) return target.join(',');
  const constraint = (
    meta.driverAdapterError as DriverAdapterErrorMeta | undefined
  )?.cause?.constraint;
  if (constraint?.index) return constraint.index;
  if (constraint?.fields?.length) return constraint.fields.join(',');
  return null;
}
