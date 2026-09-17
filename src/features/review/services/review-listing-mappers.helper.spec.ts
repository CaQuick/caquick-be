import type {
  ProductReviewRow,
  StoreReviewRow,
} from '@/features/review/repositories/review-read.repository';
import {
  toProductReview,
  toReviewMedia,
  toStoreReview,
} from '@/features/review/services/review-listing-mappers.helper';
import { Prisma } from '@/generated/prisma/client';

const MEDIA = {
  media_type: 'IMAGE' as const,
  media_url: 'a.png',
  thumbnail_url: 't.png',
  sort_order: 0,
};

function storeRow(o: Partial<StoreReviewRow> = {}): StoreReviewRow {
  return {
    id: 1n,
    rating: new Prisma.Decimal('4.5'),
    content: '맛있어요',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    account: { user_profile: { nickname: '구매자1', deleted_at: null } },
    order_item: { product_name_snapshot: '레터링 케이크' },
    media: [MEDIA],
    ...o,
  };
}

function productRow(o: Partial<ProductReviewRow> = {}): ProductReviewRow {
  return {
    id: 1n,
    rating: new Prisma.Decimal('4.5'),
    content: '맛있어요',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    account: {
      user_profile: {
        nickname: '구매자1',
        profile_image_url: 'p.png',
        deleted_at: null,
      },
    },
    order_item: {
      option_items: [
        { group_name_snapshot: '모양', option_title_snapshot: '동그라미' },
      ],
    },
    media: [MEDIA],
    ...o,
  };
}

describe('toReviewMedia', () => {
  it('row를 ReviewMedia로 매핑한다', () => {
    expect(toReviewMedia(MEDIA)).toEqual({
      mediaType: 'IMAGE',
      mediaUrl: 'a.png',
      thumbnailUrl: 't.png',
      sortOrder: 0,
    });
  });
});

describe('toStoreReview', () => {
  it('row를 StoreReview로 매핑한다(rating number·media·productName·author)', () => {
    expect(toStoreReview(storeRow(), { likeCount: 3, isLiked: true })).toEqual({
      id: '1',
      rating: 4.5,
      content: '맛있어요',
      media: [toReviewMedia(MEDIA)],
      likeCount: 3,
      isLiked: true,
      authorNickname: '구매자1',
      productName: '레터링 케이크',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it.each([
    ['user_profile 없음', { user_profile: null }],
    [
      '탈퇴(soft-delete)',
      { user_profile: { nickname: 'deleted_1', deleted_at: new Date() } },
    ],
  ])('%s이면 authorNickname은 null', (_label, account) => {
    const result = toStoreReview(storeRow({ account }), {
      likeCount: 0,
      isLiked: false,
    });
    expect(result.authorNickname).toBeNull();
  });

  it('media가 없으면 빈 배열', () => {
    expect(
      toStoreReview(storeRow({ media: [] }), { likeCount: 0, isLiked: false })
        .media,
    ).toEqual([]);
  });
});

describe('toProductReview', () => {
  it('row를 ProductReview로 매핑한다(프로필 이미지·커스텀 옵션·댓글 수)', () => {
    expect(
      toProductReview(productRow(), {
        likeCount: 2,
        isLiked: false,
        commentCount: 1,
      }),
    ).toEqual({
      id: '1',
      rating: 4.5,
      content: '맛있어요',
      media: [toReviewMedia(MEDIA)],
      likeCount: 2,
      isLiked: false,
      commentCount: 1,
      authorNickname: '구매자1',
      authorProfileImageUrl: 'p.png',
      customOptions: [{ groupName: '모양', optionTitle: '동그라미' }],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('탈퇴 작성자는 닉네임·프로필 이미지를 모두 익명화한다', () => {
    const result = toProductReview(
      productRow({
        account: {
          user_profile: {
            nickname: 'deleted_1',
            profile_image_url: 'p.png',
            deleted_at: new Date(),
          },
        },
      }),
      { likeCount: 0, isLiked: false, commentCount: 0 },
    );
    expect(result.authorNickname).toBeNull();
    expect(result.authorProfileImageUrl).toBeNull();
  });
});
