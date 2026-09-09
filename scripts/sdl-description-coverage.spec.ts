import {
  collectCoverage,
  findViolations,
  isExemptFieldName,
  isPlaceholderDescription,
  percentOf,
} from './sdl-description-coverage';
import type { Category, Coverage } from './sdl-description-coverage';

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
    const thresholds = Object.fromEntries(
      ['rootField', 'rootArgScalar', 'inputType', 'inputField', 'outputType', 'outputField', 'enumType', 'enumValue'].map(
        (c) => [c, 0],
      ),
    ) as Record<Category, number>;

    it('임계치 미달 항목만 돌려준다', () => {
      const coverage = coverageOf(`
        extend type Query {
          productDetail(productId: ID!): String!
        }
      `);
      expect(findViolations(coverage, { ...thresholds, rootField: 100 })).toMatchObject([
        { category: 'rootField', actual: 0, threshold: 100 },
      ]);
      expect(findViolations(coverage, thresholds)).toEqual([]);
    });

    it('실측치를 그대로 임계치로 박아도 자기 자신에게 걸리지 않는다', () => {
      // 임계치를 달성치로 고정하는 운용이라 부동소수 오차 방어가 필요하다
      const coverage = coverageOf(`
        """설명 있음."""
        type A { """값.""" one: String, two: String, three: String }
      `);
      const actual = percentOf(coverage.outputField); // 1/3 = 33.33...
      expect(findViolations(coverage, { ...thresholds, outputField: actual })).toEqual([]);
    });
  });
});
