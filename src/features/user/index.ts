// cross-feature 공개 API. 전화번호 정책과 활성 USER 판정을 주문 생성(order feature)이
// 공유한다 — 정책 복제 대신 단일 소스를 소비한다(이슈 #226).
export { PHONE_REGEX } from '@/features/user/constants/user.constants';
export { evaluateActiveUserAccount } from '@/features/user/services/user-account-policy.helper';
