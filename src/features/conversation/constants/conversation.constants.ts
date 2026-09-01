// 인사말 템플릿 placeholder. 매장 커스텀 인사말과 기본 문구가 공유한다.
export const GREETING_NICKNAME_PLACEHOLDER = '{nickname}';
export const GREETING_STORE_NAME_PLACEHOLDER = '{storeName}';

// figma notification-center 문의 채팅 인사말 기준(자체 판단: placeholder 형식).
// 매장이 greeting_message를 설정하지 않았을 때 사용한다.
export const DEFAULT_GREETING_TEMPLATE =
  '안녕하세요! {nickname} 고객님.\n{storeName} 입니다 😄\n무엇을 도와드릴까요?';

// 구매자 텍스트 메시지 상한. 판매자 측 MAX_CONVERSATION_BODY_TEXT_LENGTH와 동일 정책.
export const MAX_INQUIRY_BODY_TEXT_LENGTH = 2000;

// 대화 목록/채팅 상세 페이지네이션 기본값(상한 50은 DTO가 검증)
export const DEFAULT_CONVERSATION_LIST_LIMIT = 20;
export const DEFAULT_CONVERSATION_MESSAGES_LIMIT = 30;
export const MAX_CONVERSATION_PAGE_LIMIT = 50;
