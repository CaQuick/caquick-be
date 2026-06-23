import { Prisma } from '@prisma/client';

import type { StoreReviewRow } from '@/features/store/repositories/store-review.repository';
import { toStoreReview } from '@/features/store/services/store-review-mappers.helper';

function makeRow(o: Partial<StoreReviewRow> = {}): StoreReviewRow {
  return {
    id: 1n,
    rating: new Prisma.Decimal('4.5'),
    content: '맛있어요',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    account: { user_profile: { nickname: '구매자1' } },
    order_item: { product_name_snapshot: '레터링 케이크' },
    media: [
      {
        media_type: 'IMAGE',
        media_url: 'a.png',
        thumbnail_url: 't.png',
        sort_order: 0,
      },
    ],
    ...o,
  };
}

describe('toStoreReview', () => {
  it('row를 StoreReview로 매핑한다(rating number·media·productName·author)', () => {
    const result = toStoreReview(makeRow(), 3, true);
    expect(result).toEqual({
      id: '1',
      rating: 4.5,
      content: '맛있어요',
      media: [
        {
          mediaType: 'IMAGE',
          mediaUrl: 'a.png',
          thumbnailUrl: 't.png',
          sortOrder: 0,
        },
      ],
      likeCount: 3,
      isLiked: true,
      authorNickname: '구매자1',
      productName: '레터링 케이크',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('user_profile이 없으면 authorNickname은 null', () => {
    const result = toStoreReview(
      makeRow({ account: { user_profile: null } }),
      0,
      false,
    );
    expect(result.authorNickname).toBeNull();
  });

  it('media가 없으면 빈 배열, likeCount/isLiked 인자를 반영', () => {
    const result = toStoreReview(makeRow({ media: [] }), 0, false);
    expect(result.media).toEqual([]);
    expect(result.likeCount).toBe(0);
    expect(result.isLiked).toBe(false);
  });
});
