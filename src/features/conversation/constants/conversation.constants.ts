// 인사말 템플릿 placeholder. 매장 커스텀 인사말과 기본 문구가 공유한다.
export const GREETING_NICKNAME_PLACEHOLDER = '{nickname}';
export const GREETING_STORE_NAME_PLACEHOLDER = '{storeName}';

// 매장이 greeting_message를 설정하지 않았을 때 사용한다.
export const DEFAULT_GREETING_TEMPLATE =
  '안녕하세요! {nickname} 고객님.\n{storeName} 입니다 😄\n무엇을 도와드릴까요?';

export const MAX_INQUIRY_BODY_TEXT_LENGTH = 2000;
// 판매자 답장도 구매자 문의와 같은 본문 정책.
export const MAX_CONVERSATION_BODY_TEXT_LENGTH = MAX_INQUIRY_BODY_TEXT_LENGTH;
// store.greeting_message VARCHAR(500)과 동일 상한
export const MAX_CONVERSATION_BODY_HTML_LENGTH = 100000;
