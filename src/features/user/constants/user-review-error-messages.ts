export const USER_REVIEW_ERRORS = {
  TOO_MANY_IMAGES: '사진은 최대 10장까지 첨부할 수 있습니다.',
  TOO_MANY_VIDEOS: '동영상은 최대 1개까지 첨부할 수 있습니다.',
  INVALID_MEDIA_URL: '업로드 URL로 발급된 미디어 URL만 저장할 수 있습니다.',
  ORDER_ITEM_NOT_FOUND: '주문 아이템을 찾을 수 없습니다.',
  CANNOT_WRITE_REVIEW: '리뷰를 작성할 수 없는 주문입니다.',
  REVIEW_ALREADY_EXISTS: '이미 리뷰가 작성된 주문 아이템입니다.',
  REVIEW_NOT_FOUND: '리뷰를 찾을 수 없습니다.',
  COMMENT_NOT_FOUND: '댓글을 찾을 수 없습니다.',
  NOT_COMMENT_OWNER: '본인 댓글만 삭제할 수 있습니다.',
  CANNOT_REPORT_OWN_CONTENT: '본인이 작성한 리뷰·댓글은 신고할 수 없습니다.',
} as const;
