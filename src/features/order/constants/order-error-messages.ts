/** 주문 생성(체크아웃) 에러 메시지. */
export const ORDER_CHECKOUT_ERRORS = {
  PRODUCT_NOT_FOUND: '상품을 찾을 수 없습니다.',
  DUPLICATE_OPTION_ITEM: '중복된 옵션 선택입니다.',
  INVALID_OPTION_ITEM: '해당 상품의 옵션이 아닙니다.',
  OPTION_GROUP_RULE_VIOLATION: '옵션 그룹의 선택 규칙을 충족하지 않습니다.',
  PICKUP_NOT_AVAILABLE: '선택한 픽업 일시는 예약할 수 없습니다.',
  BUYER_NAME_REQUIRED: '주문자 이름이 필요합니다.',
  BUYER_PHONE_REQUIRED:
    '주문자 연락처가 필요합니다. 프로필에 전화번호를 등록하거나 입력해 주세요.',
  ORDER_NUMBER_GENERATION_FAILED:
    '주문번호 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.',
} as const;
