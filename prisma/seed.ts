/**
 * 마이페이지 검증용 시드 데이터.
 *
 * 실행: yarn prisma:seed
 *
 * - 기존 시드 영역(seed-user-* 이메일, [SEED] * 매장명)을 정리한 뒤 재삽입한다 (idempotent).
 * - production 환경에서는 자동 차단된다.
 *
 * 발급된 테스트 accountId가 콘솔에 출력되며, GraphQL Playground에서 dev 토큰
 * 발급 헬퍼(POST /auth/dev/issue-token)와 함께 사용한다.
 */
import { PrismaClient } from '@prisma/client';

import { seedCustomDrafts } from './seed/custom-drafts';
import { resetSeedScope } from './seed/idempotent';
import { seedNotifications } from './seed/notifications';
import { seedOrders } from './seed/orders';
import { seedRecentViews } from './seed/recent-views';
import { seedReviews } from './seed/reviews';
import { seedSearchHistory } from './seed/search-history';
import { seedStores } from './seed/stores';
import { seedUsers } from './seed/users';
import { seedWishlist } from './seed/wishlist';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed는 production 환경에서 실행할 수 없습니다.');
  }

  const prisma = new PrismaClient();
  try {
    log('기존 시드 영역 정리 중...');
    await resetSeedScope(prisma);

    log('유저 + 프로필 시드 중...');
    const users = await seedUsers(prisma);

    log('매장 + 상품 시드 중...');
    const stores = await seedStores(prisma);

    log('주문 + 아이템 시드 중...');
    const orders = await seedOrders(prisma, { users, stores });

    log('리뷰 시드 중...');
    await seedReviews(prisma, { users, stores, orders });

    log('찜 시드 중...');
    await seedWishlist(prisma, { users, stores });

    log('최근 본 상품 시드 중...');
    await seedRecentViews(prisma, { users, stores });

    log('알림 시드 중...');
    await seedNotifications(prisma, { users });

    log('커스텀 드래프트 시드 중...');
    await seedCustomDrafts(prisma, { users, stores });

    log('검색 히스토리 시드 중...');
    await seedSearchHistory(prisma, { users });

    log('완료. 발급된 테스트 계정:');
    for (const u of users) {
      const status =
        u.name === null
          ? '온보딩 미완료 (needsProfile=true 검증용)'
          : '온보딩 완료';
      log(`  - accountId=${u.id.toString()} email=${u.email} (${status})`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

function log(message: string): void {
  console.log(`[seed] ${message}`);
}

main().catch((err: unknown) => {
  console.error('[seed] 실패:', err);
  process.exit(1);
});
