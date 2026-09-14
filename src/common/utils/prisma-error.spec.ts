import {
  isUniqueConstraintOn,
  uniqueConstraintNameOf,
} from '@/common/utils/prisma-error';

/**
 * 제약 이름 추출기의 반증 표.
 *
 * 이 헬퍼가 조용히 null을 반환하면 주문 생성이 "멱등 키 충돌"을 "주문번호 충돌"로
 * 오인해 재시도만 하다 500으로 끝난다(Prisma 7 업그레이드에서 실제로 발생).
 * 따라서 **읽어야 하는 형식**과 **읽으면 안 되는 형식**을 모두 표로 고정한다.
 */
describe('uniqueConstraintNameOf', () => {
  /** Prisma 7 드라이버 어댑터(mariadb)가 실제로 주는 형태 */
  const adapterError = {
    meta: {
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          originalCode: '1062',
          originalMessage:
            "Duplicate entry '2-key' for key 'order.uk_order_account_idempotency'",
          kind: 'UniqueConstraintViolation',
          constraint: { index: 'uk_order_account_idempotency' },
          table: 'order',
        },
      },
      modelName: 'Order',
    },
  };

  it.each([
    {
      label: 'Prisma 7 어댑터 — constraint.index',
      error: adapterError,
      expected: 'uk_order_account_idempotency',
    },
    {
      label: 'Prisma 7 어댑터 — constraint.fields 배열',
      error: {
        meta: {
          driverAdapterError: {
            cause: {
              constraint: { fields: ['account_id', 'idempotency_key'] },
            },
          },
        },
      },
      expected: 'account_id,idempotency_key',
    },
    {
      label: 'Prisma 7 어댑터 — constraint 가 문자열',
      error: {
        meta: { driverAdapterError: { cause: { constraint: 'uk_order_x' } } },
      },
      expected: 'uk_order_x',
    },
    {
      label: 'Prisma 6 엔진 — meta.target 문자열(MySQL)',
      error: { meta: { target: 'uk_order_account_idempotency' } },
      expected: 'uk_order_account_idempotency',
    },
    {
      label: 'Prisma 6 엔진 — meta.target 배열',
      error: { meta: { target: ['account_id', 'idempotency_key'] } },
      expected: 'account_id,idempotency_key',
    },
    {
      label: '어댑터 정보가 비어 있으면 meta.target 으로 폴백',
      error: { meta: { driverAdapterError: {}, target: 'uk_fallback' } },
      expected: 'uk_fallback',
    },
  ])('$label → $expected', ({ error, expected }) => {
    expect(uniqueConstraintNameOf(error)).toBe(expected);
  });

  it.each([
    { label: 'null', error: null },
    { label: 'undefined', error: undefined },
    { label: '문자열', error: 'boom' },
    { label: 'meta 없음', error: { code: 'P2002' } },
    { label: 'meta 가 객체 아님', error: { meta: 'x' } },
    { label: 'target 이 숫자', error: { meta: { target: 42 } } },
    { label: 'target 이 빈 문자열', error: { meta: { target: '' } } },
    { label: 'target 이 빈 배열', error: { meta: { target: [] } } },
    {
      label: 'target 배열에 문자열이 없음',
      error: { meta: { target: [1, 2] } },
    },
    {
      label: 'constraint 가 객체지만 index·fields 없음',
      error: { meta: { driverAdapterError: { cause: { constraint: {} } } } },
    },
  ])('$label 이면 null', ({ error }) => {
    expect(uniqueConstraintNameOf(error)).toBeNull();
  });
});

describe('isUniqueConstraintOn', () => {
  const idempotencyConflict = {
    meta: {
      driverAdapterError: {
        cause: { constraint: { index: 'uk_order_account_idempotency' } },
      },
    },
  };
  const orderNumberConflict = {
    meta: {
      driverAdapterError: {
        cause: { constraint: { index: 'order_order_number_key' } },
      },
    },
  };

  it('같은 테이블의 다른 unique 를 구분한다', () => {
    // 주문 생성의 분기 자체 — 섞이면 멱등 replay 가 재시도 루프로 바뀐다.
    expect(isUniqueConstraintOn(idempotencyConflict, 'idempotency')).toBe(true);
    expect(isUniqueConstraintOn(orderNumberConflict, 'idempotency')).toBe(
      false,
    );
    expect(isUniqueConstraintOn(orderNumberConflict, 'order_number')).toBe(
      true,
    );
  });

  it('이름을 모르면 false (조용히 true 가 되지 않는다)', () => {
    expect(isUniqueConstraintOn({ code: 'P2002' }, 'idempotency')).toBe(false);
    expect(isUniqueConstraintOn(null, 'idempotency')).toBe(false);
  });
});
