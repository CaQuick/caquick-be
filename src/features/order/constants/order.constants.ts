/**
 * 주문자 전화번호 형식. 프로필 전화번호 정책(user feature `PHONE_REGEX`,
 * 010-XXXX-XXXX 고정 13자)과 동일해야 한다 — user는 배럴 없는 feature라
 * cross-feature import 대신 정책을 복제하고 출처를 명시한다.
 */
export const ORDER_BUYER_PHONE_REGEX = /^010-\d{4}-\d{4}$/;
