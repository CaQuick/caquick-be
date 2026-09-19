// cross-feature 공개 API. 관리자 컨텍스트(계정 상태 재확인)와 관리자용 계정 조회는 identity가 가진다.
export { AuthModule } from '@/features/auth/auth.module';
export { AdminBaseService } from '@/features/auth/services/auth-admin-base.service';
export { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
