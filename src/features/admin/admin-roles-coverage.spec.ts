import { Mutation } from '@nestjs/graphql';

import {
  collectFeatureResolverClasses,
  collectHandlerAuth,
  collectRootFieldsWithPrefix,
  violationsOf,
} from '@/test/role-coverage.helper';

describe('admin 루트 필드 인가 커버리지', () => {
  const adminFields = collectRootFieldsWithPrefix('admin');
  // 관리자 핸들러가 도메인 feature로 흩어지는 중(04a~)이라 모든 feature 모듈에서 찾는다 — 04e에서 roles-coverage.spec으로 통합
  const handlerAuth = collectHandlerAuth(collectFeatureResolverClasses());

  it('SDL에서 admin 접두 루트 필드를 읽어 왔다(입력 공간이 비어 있지 않다)', () => {
    expect(adminFields.length).toBeGreaterThan(0);
  });

  it.each(adminFields)(
    '%s 핸들러는 RolesGuard + @Roles(ADMIN)를 갖춘다',
    (fieldName) => {
      expect(violationsOf(handlerAuth.get(fieldName), 'ADMIN')).toEqual([]);
    },
  );

  describe('검출기 반증', () => {
    it('판매자 역할만 선언한 핸들러는 ADMIN 기준에서 걸린다', () => {
      class SellerRoleResolver {
        @Mutation('adminWrongRole')
        adminWrongRole(): string {
          return '';
        }
      }
      Reflect.defineMetadata(
        'auth:roles',
        ['SELLER'],
        SellerRoleResolver.prototype.adminWrongRole,
      );
      const auth = collectHandlerAuth([SellerRoleResolver]).get(
        'adminWrongRole',
      );
      expect(violationsOf(auth, 'ADMIN')).toEqual([
        'RolesGuard 미적용',
        "@Roles('ADMIN') 없음",
      ]);
    });
  });
});
