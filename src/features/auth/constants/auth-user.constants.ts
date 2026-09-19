// ── 닉네임 ──

export const MIN_NICKNAME_LENGTH = 2;
export const MAX_NICKNAME_LENGTH = 20;

// ── 전화번호 ──

// 010-XXXX-XXXX 고정(13자).
export const PHONE_REGEX = /^010-\d{4}-\d{4}$/;
export const PHONE_FORMAT_EXAMPLE = '010-XXXX-XXXX';

// ── 생년월일 ──

// 1900-01-01 이전 입력은 봇/오입력으로 보고 거부한다. GraphQL DateTime은 ISO string을 UTC로 해석하므로
// 비교 기준도 UTC 자정으로 둔다 — 운영 timezone과 무관하게 동일하게 동작.
export const MIN_BIRTH_DATE = new Date(Date.UTC(1900, 0, 1));

// ── 페이지네이션 ──

export const DEFAULT_PAGINATION_LIMIT = 20;
export const MAX_PAGINATION_LIMIT = 50;
