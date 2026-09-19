import { Query } from '@nestjs/graphql';

import { ConversationSubscriptionResolver } from '@/features/conversation/resolvers/conversation-subscription.resolver';
import { SellerModule } from '@/features/seller/seller.module';
import { StoreModule } from '@/features/store';
import {
  collectHandlerAuth,
  collectRootFieldsWithPrefix,
  resolverClassesOf,
  violationsOf,
} from '@/test/role-coverage.helper';

describe('seller 루트 필드 인가 커버리지', () => {
  const sellerFields = collectRootFieldsWithPrefix('seller');
  const handlerAuth = collectHandlerAuth([
    ...resolverClassesOf(SellerModule),
    // 판매자 매장 관리 핸들러는 store feature로 옮겨졌다(03a) — 03d에서 spec 통합
    ...resolverClassesOf(StoreModule),
    ConversationSubscriptionResolver,
  ]);

  it('SDL에서 seller 접두 루트 필드를 읽어 왔다(입력 공간이 비어 있지 않다)', () => {
    expect(sellerFields.length).toBeGreaterThan(30);
  });

  it.each(sellerFields)(
    '%s 핸들러는 RolesGuard + @Roles(SELLER)를 갖춘다',
    (fieldName) => {
      expect(violationsOf(handlerAuth.get(fieldName), 'SELLER')).toEqual([]);
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
  });
});
