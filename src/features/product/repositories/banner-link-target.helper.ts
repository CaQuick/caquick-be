import type { Prisma } from '@/generated/prisma/client';
import { visibleWhere } from '@/prisma';

/**
 * 링크 대상이 노출 가능한 배너. 구매자 배너 선택과 관리자 linkTargetAvailable이 이 조각 하나를 쓴다 —
 * 대상이 내려간 배너를 노출하면 클릭이 죽은 화면으로 떨어지므로 구매자 조회는 다음 배너로 넘어간다.
 */
export const bannerLinkTargetVisibleWhere: Prisma.BannerWhereInput = {
  OR: [
    { link_type: { in: ['NONE', 'URL'] } },
    {
      link_type: 'PRODUCT',
      link_product: { ...visibleWhere, store: visibleWhere },
    },
    { link_type: 'STORE', link_store: visibleWhere },
    { link_type: 'CATEGORY', link_category: visibleWhere },
  ],
};
