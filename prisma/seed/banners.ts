/**
 * 배너 시드(검색 진입 화면 SEARCH 지면 1건).
 * title을 SEED_BANNER_TITLE_PREFIX로 시작시켜 resetSeedScope가 자기 영역만 정리한다.
 * 링크는 NONE — 시드 매장/상품 FK에 묶이지 않아 재시드 순서와 무관하다.
 */
import type { PrismaClient } from '@prisma/client';

import { SEED_BANNER_TITLE_PREFIX } from './idempotent';

export async function seedBanners(prisma: PrismaClient): Promise<void> {
  await prisma.banner.create({
    data: {
      placement: 'SEARCH',
      title: `${SEED_BANNER_TITLE_PREFIX}검색 진입 배너`,
      image_url: 'https://picsum.photos/seed/caquick-search/750/220',
      link_type: 'NONE',
      sort_order: 0,
    },
  });
}
