import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/features/audit-log';
import { AuthService } from '@/features/auth/auth.service';
import { AuthController } from '@/features/auth/controllers/auth.controller';
import { JwksController } from '@/features/auth/controllers/jwks.controller';
import { AccountAdminRepository } from '@/features/auth/repositories/account-admin.repository';
import { AccountCredentialRepository } from '@/features/auth/repositories/account-credential.repository';
import { ACCOUNT_CREDENTIAL_REPOSITORY } from '@/features/auth/repositories/account-credential.repository.interface';
import { AccountUserRepository } from '@/features/auth/repositories/account-user.repository';
import { AccountRepository } from '@/features/auth/repositories/account.repository';
import { ACCOUNT_REPOSITORY } from '@/features/auth/repositories/account.repository.interface';
import { BlacklistRebuildRepository } from '@/features/auth/repositories/blacklist-rebuild.repository';
import { RefreshSessionRepository } from '@/features/auth/repositories/refresh-session.repository';
import { REFRESH_SESSION_REPOSITORY } from '@/features/auth/repositories/refresh-session.repository.interface';
import { AdminAccountMutationResolver } from '@/features/auth/resolvers/auth-admin-account-mutation.resolver';
import { AdminAccountQueryResolver } from '@/features/auth/resolvers/auth-admin-account-query.resolver';
import { AdminUserMutationResolver } from '@/features/auth/resolvers/auth-admin-user-mutation.resolver';
import { AdminUserQueryResolver } from '@/features/auth/resolvers/auth-admin-user-query.resolver';
import { UserProfileMutationResolver } from '@/features/auth/resolvers/auth-user-profile-mutation.resolver';
import { UserProfileQueryResolver } from '@/features/auth/resolvers/auth-user-profile-query.resolver';
import { AdminAccountService } from '@/features/auth/services/auth-admin-account.service';
import { AdminUserService } from '@/features/auth/services/auth-admin-user.service';
import { UserProfileService } from '@/features/auth/services/auth-user-profile.service';
import { BlacklistRebuildService } from '@/features/auth/services/blacklist-rebuild.service';
import { CredentialAuthService } from '@/features/auth/services/credential-auth.service';
import { OidcClientService } from '@/features/auth/services/oidc-client.service';
import { OidcLoginService } from '@/features/auth/services/oidc-login.service';
import { TokenService } from '@/features/auth/services/token.service';
import { JwtBearerStrategy } from '@/features/auth/strategies/jwt-bearer.strategy';
import { AuthGlobalModule } from '@/global/auth/auth-global.module';

@Module({
  imports: [AuthGlobalModule, AuditLogModule],
  controllers: [AuthController, JwksController],
  providers: [
    AuthService,
    OidcClientService,
    OidcLoginService,
    CredentialAuthService,
    TokenService,
    {
      provide: ACCOUNT_REPOSITORY,
      useClass: AccountRepository,
    },
    {
      provide: ACCOUNT_CREDENTIAL_REPOSITORY,
      useClass: AccountCredentialRepository,
    },
    {
      provide: REFRESH_SESSION_REPOSITORY,
      useClass: RefreshSessionRepository,
    },
    JwtBearerStrategy,
    // worker가 TTL 창 안의 정지·탈퇴·비밀번호 변경을 Redis에 다시 채운다(P2 03)
    BlacklistRebuildRepository,
    BlacklistRebuildService,
    // 관리자용 계정 관리(관리자·구매자 계정) — identity가 소유한다. 판매자 온보딩 화면은 store(매장 생성 tx 콜백)
    AccountAdminRepository,
    AdminAccountService,
    AdminUserService,
    AdminAccountQueryResolver,
    AdminAccountMutationResolver,
    AdminUserQueryResolver,
    AdminUserMutationResolver,
    // 구매자 계정·프로필(me·온보딩·수정·탈퇴) — identity가 소유한다
    AccountUserRepository,
    UserProfileService,
    UserProfileQueryResolver,
    UserProfileMutationResolver,
  ],
  // AccountAdminRepository는 관리자 컨텍스트(AdminBaseService) 조회로 admin 파생 서비스 전부가 쓴다
  exports: [AuthService, AccountAdminRepository, AccountUserRepository],
})
export class AuthModule {}
