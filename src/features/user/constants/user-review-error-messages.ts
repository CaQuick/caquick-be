export const USER_REVIEW_ERRORS = {
  INVALID_RATING: '별점은 1.0~5.0 사이, 0.5 단위여야 합니다.',
  CONTENT_TOO_SHORT: '리뷰는 최소 20자 이상이어야 합니다.',
  CONTENT_TOO_LONG: '리뷰는 최대 1000자까지 작성 가능합니다.',
  TOO_MANY_MEDIA: '미디어는 최대 10개까지 첨부할 수 있습니다.',
  ORDER_ITEM_NOT_FOUND: '주문 아이템을 찾을 수 없습니다.',
  CANNOT_WRITE_REVIEW: '리뷰를 작성할 수 없는 주문입니다.',
  REVIEW_ALREADY_EXISTS: '이미 리뷰가 작성된 주문 아이템입니다.',
  REVIEW_NOT_FOUND: '리뷰를 찾을 수 없습니다.',
} as const;
