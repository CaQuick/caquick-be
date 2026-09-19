import { Query } from '@nestjs/graphql';

import {
  collectHandlerAuth,
  collectRootFieldsWithPrefix,
  collectFeatureResolverClasses,
  violationsOf,
} from '@/test/role-coverage.helper';

// 행위자 feature(seller)가 도메인 feature로 흩어진 뒤에도 접두 루트 필드 전수가 역할 가드를 갖추는지 본다.
// 입력 공간은 SDL에서 읽고, 핸들러는 src/features의 모든 모듈 Resolver에서 찾는다 — 어느 feature에 있든 상관없다.
describe('접두 루트 필드 인가 커버리지', () => {
  const handlerAuth = collectHandlerAuth(collectFeatureResolverClasses());

  describe.each([['seller', 'SELLER', 48]] as const)(
    '%s 접두 → @Roles(%s)',
    (prefix, role, count) => {
      const fields = collectRootFieldsWithPrefix(prefix);

      it(`SDL의 ${prefix} 접두 루트 필드는 ${count}개다(표가 비거나 모르게 늘지 않는다)`, () => {
        expect(fields).toHaveLength(count);
      });

      it.each(fields)(
        '%s 핸들러는 RolesGuard + @Roles를 갖춘다',
        (fieldName) => {
          expect(violationsOf(handlerAuth.get(fieldName), role)).toEqual([]);
        },
      );
    },
  );

  describe('검출기 반증', () => {
    it('가드 없는 핸들러는 두 사유 모두로 걸린다', () => {
      class UnguardedResolver {
        @Query('sellerUnguarded')
        sellerUnguarded(): string {
          return '';
        }
      }
      const auth = collectHandlerAuth([UnguardedResolver]).get(
        'sellerUnguarded',
      );
      expect(violationsOf(auth, 'SELLER')).toEqual([
        'RolesGuard 미적용',
        "@Roles('SELLER') 없음",
      ]);
    });

    it('핸들러 자체가 없으면 걸린다', () => {
      expect(violationsOf(undefined, 'SELLER')).toEqual(['핸들러 없음']);
    });

    it('feature 모듈에서 판매자 핸들러를 실제로 찾는다(수집기가 비어 있지 않다)', () => {
      expect(handlerAuth.has('sellerMyStore')).toBe(true);
      expect(handlerAuth.has('sellerOrderList')).toBe(true);
    });
  });
});
