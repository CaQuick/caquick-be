// cross-feature 공개 API. 관리자 컨텍스트(계정 상태 재확인)와 관리자용 계정 조회는 identity가 가진다.
export { AuthModule } from '@/features/auth/auth.module';
export { AdminBaseService } from '@/features/auth/services/auth-admin-base.service';
export { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
// 관리자용 계정 row 타입(판매자 온보딩 화면은 store가 가진다)과 계정 입력 정책.
export type { AdminSellerRow } from '@/features/auth/repositories/account-admin.repository';
export * from '@/features/auth/constants/auth-admin.constants';
// 구매자 컨텍스트(활성 사용자 재확인)·계정/프로필 저장소·정책. 구매자 화면 서비스(review·notification·mypage·order·conversation)가 쓴다.
export { UserBaseService } from '@/features/auth/services/auth-user-base.service';
export { AccountUserRepository } from '@/features/auth/repositories/account-user.repository';
export { evaluateActiveUserAccount } from '@/features/auth/services/auth-user-account-policy.helper';
export * from '@/features/auth/constants/auth-user.constants';
