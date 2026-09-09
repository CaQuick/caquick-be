import {
  CATEGORIES,
  collectCoverage,
  findViolations,
  isExemptFieldName,
  isPlaceholderDescription,
  percentOf,
} from './sdl-description-coverage';
import type { Baseline, Category, Coverage } from './sdl-description-coverage';

// DB 불필요한 순수 단위 테스트. SDL 문자열만으로 검증한다.
describe('sdl-description-coverage', () => {
  function coverageOf(sdl: string): Coverage {
    return collectCoverage([{ path: 'test.graphql', sdl }]);
  }

  describe('isPlaceholderDescription', () => {
    it('타입 이름을 되풀이하기만 하면 플레이스홀더로 본다', () => {
      expect(isPlaceholderDescription('SellerOrder', 'SellerOrder 타입')).toBe(
        true,
      );
      expect(
        isPlaceholderDescription('SellerOrderListInput', 'SellerOrderListInput 입력 타입'),
      ).toBe(true);
      expect(
        isPlaceholderDescription('SellerStoreMapProvider', 'SellerStoreMapProvider 열거형'),
      ).toBe(true);
      expect(isPlaceholderDescription('SellerOrder', 'SellerOrder')).toBe(true);
    });

    it('빈 설명도 플레이스홀더로 본다', () => {
      expect(isPlaceholderDescription('SellerOrder', '')).toBe(true);
      expect(isPlaceholderDescription('SellerOrder', '   ')).toBe(true);
    });

    it('실제 의미가 담긴 설명은 플레이스홀더가 아니다', () => {
      expect(
        isPlaceholderDescription('CreateOrderInput', '주문 생성 입력. 옵션을 서버가 재검증한다.'),
      ).toBe(false);
      // 이름으로 시작하더라도 뒤에 내용이 붙으면 정보가 있다
      expect(
        isPlaceholderDescription('SellerOrder', 'SellerOrder 타입. 판매자 화면 주문 카드.'),
      ).toBe(false);
    });
  });

  describe('isExemptFieldName', () => {
    it('자명한 필드와 식별자 접미사는 제외한다', () => {
      expect(isExemptFieldName('id')).toBe(true);
      expect(isExemptFieldName('createdAt')).toBe(true);
      expect(isExemptFieldName('productId')).toBe(true);
      expect(isExemptFieldName('optionItemIds')).toBe(true);
    });

    it('비자명 필드는 제외하지 않는다', () => {
      expect(isExemptFieldName('pickupAt')).toBe(false);
      expect(isExemptFieldName('nextCursor')).toBe(false);
      expect(isExemptFieldName('idempotencyKey')).toBe(false);
      // 'Id'로 끝나지 않는 이름이 우연히 걸리지 않아야 한다
      expect(isExemptFieldName('valid')).toBe(false);
    });
  });

  describe('collectCoverage', () => {
    it('루트 필드 설명 유무를 집계한다', () => {
      const coverage = coverageOf(`
        extend type Query {
          """상품 상세를 조회한다."""
          productDetail(productId: ID!): String!
          storeDetail(storeId: ID!): String!
        }
      `);
      expect(coverage.rootField).toMatchObject({ documented: 1, total: 2 });
      expect(coverage.rootField.missing).toEqual(['test.graphql: Query.storeDetail']);
    });

    it('스칼라 루트 인자만 집계하고 식별자 인자는 제외한다', () => {
      const coverage = coverageOf(`
        extend type Query {
          """픽업 달력."""
          pickupCalendar(yearMonth: String!, storeId: ID!, input: SomeInput): String!
        }
        input SomeInput { """값.""" value: String }
      `);
      // yearMonth만 대상 — storeId는 식별자, input은 input 객체
      expect(coverage.rootArgScalar).toMatchObject({ documented: 0, total: 1 });
      expect(coverage.rootArgScalar.missing).toEqual([
        'test.graphql: Query.pickupCalendar(yearMonth)',
      ]);
    });

    it('플레이스홀더 설명이 붙은 타입은 미기재로 센다', () => {
      const coverage = coverageOf(`
        """SellerOrder 타입"""
        type SellerOrder {
          """주문번호."""
          orderNumber: String!
        }
      `);
      expect(coverage.outputType).toMatchObject({ documented: 0, total: 1 });
      expect(coverage.outputField).toMatchObject({ documented: 1, total: 1 });
    });

    it('자명한 필드는 분모에서 뺀다', () => {
      const coverage = coverageOf(`
        """주문 카드."""
        type Order {
          id: ID!
          createdAt: DateTime!
          storeId: ID!
          pickupAt: DateTime!
        }
      `);
      // id·createdAt·storeId 제외, pickupAt만 남는다
      expect(coverage.outputField).toMatchObject({ documented: 0, total: 1 });
      expect(coverage.outputField.missing).toEqual(['test.graphql: Order.pickupAt']);
    });

    it('enum 선언과 값을 따로 집계한다', () => {
      const coverage = coverageOf(`
        """주문 상태."""
        enum OrderStatusType {
          """접수됨."""
          SUBMITTED
          CONFIRMED
        }
      `);
      expect(coverage.enumType).toMatchObject({ documented: 1, total: 1 });
      expect(coverage.enumValue).toMatchObject({ documented: 1, total: 2 });
      expect(coverage.enumValue.missing).toEqual([
        'test.graphql: OrderStatusType.CONFIRMED',
      ]);
    });

    it('input 타입 선언과 필드를 집계한다', () => {
      const coverage = coverageOf(`
        """목록 입력."""
        input MyListInput {
          """한 번에 가져올 개수."""
          limit: Int
          cursor: ID
        }
      `);
      expect(coverage.inputType).toMatchObject({ documented: 1, total: 1 });
      expect(coverage.inputField).toMatchObject({ documented: 1, total: 2 });
    });
  });

  describe('percentOf', () => {
    it('분모가 0이면 100%로 본다', () => {
      expect(percentOf({ documented: 0, total: 0, missing: [] })).toBe(100);
    });
  });

  describe('findViolations', () => {
    /** 모든 카테고리를 "회귀 없음"으로 두고, 검사할 카테고리만 덮어쓴다. */
    function baselineOf(
      overrides: Partial<Record<Category, Baseline>> = {},
    ): Record<Category, Baseline> {
      const base = CATEGORIES.reduce(
        (acc, category) => {
          acc[category] = { documented: 0, total: 0 };
          return acc;
        },
        {} as Record<Category, Baseline>,
      );
      return { ...base, ...overrides };
    }

    const oneRootField = `
      extend type Query {
        productDetail(productId: ID!): String!
      }
    `;

    it('기준선을 만족하면 위반이 없다', () => {
      const coverage = coverageOf(oneRootField);
      expect(
        findViolations(coverage, baselineOf({ rootField: { documented: 0, total: 1 } })),
      ).toEqual([]);
    });

    it('커버리지 비율이 떨어지면 ratio 위반으로 잡는다', () => {
      // 설명이 있던 필드가 사라져 비율만 내려가는 경우 (미기재 건수는 그대로)
      const coverage = coverageOf(oneRootField);
      const violations = findViolations(
        coverage,
        baselineOf({ rootField: { documented: 1, total: 2 } }),
      );
      expect(violations).toMatchObject([{ category: 'rootField', reason: 'ratio' }]);
    });

    it('미기재 건수가 늘면 count 위반으로 잡는다', () => {
      const coverage = coverageOf(`
        """설명 있음."""
        type A { """값.""" one: String, two: String, three: String }
      `);
      // 기준선 1/2(미기재 1) → 실제 1/3(미기재 2)
      expect(
        findViolations(coverage, baselineOf({ outputField: { documented: 1, total: 2 } })),
      ).toMatchObject([{ category: 'outputField', reason: 'count' }]);
    });

    it('기준선이 0%인 카테고리도 미기재 추가를 막는다', () => {
      // 비율만 보면 0/6 → 0/7도 0% >= 0%라 통과해 게이트가 성립하지 않는다
      const coverage = coverageOf(`
        extend type Query {
          """검색."""
          search(keyword: String!, cursor: String): String!
        }
      `);
      expect(percentOf(coverage.rootArgScalar)).toBe(0);
      expect(
        findViolations(coverage, baselineOf({ rootArgScalar: { documented: 0, total: 1 } })),
      ).toMatchObject([{ category: 'rootArgScalar', reason: 'count' }]);
      // 기준선이 같은 미기재 2건이면 통과
      expect(
        findViolations(coverage, baselineOf({ rootArgScalar: { documented: 0, total: 2 } })),
      ).toEqual([]);
    });

    it('실측치를 그대로 기준선으로 박아도 자기 자신에게 걸리지 않는다', () => {
      // 기준선을 실측 분수로 고정하는 운용이라 부동소수 오차 방어가 필요하다
      const coverage = coverageOf(`
        """설명 있음."""
        type A { """값.""" one: String, two: String, three: String }
      `);
      expect(
        findViolations(coverage, baselineOf({ outputField: { documented: 1, total: 3 } })),
      ).toEqual([]);
    });
  });
});
