import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/features/audit-log';
import { AuthService } from '@/features/auth/auth.service';
import { AuthController } from '@/features/auth/controllers/auth.controller';
import { AccountCredentialRepository } from '@/features/auth/repositories/account-credential.repository';
import { ACCOUNT_CREDENTIAL_REPOSITORY } from '@/features/auth/repositories/account-credential.repository.interface';
import { AccountRepository } from '@/features/auth/repositories/account.repository';
import { ACCOUNT_REPOSITORY } from '@/features/auth/repositories/account.repository.interface';
import { RefreshSessionRepository } from '@/features/auth/repositories/refresh-session.repository';
import { REFRESH_SESSION_REPOSITORY } from '@/features/auth/repositories/refresh-session.repository.interface';
import { CredentialAuthService } from '@/features/auth/services/credential-auth.service';
import { OidcClientService } from '@/features/auth/services/oidc-client.service';
import { OidcLoginService } from '@/features/auth/services/oidc-login.service';
import { TokenService } from '@/features/auth/services/token.service';
import { JwtBearerStrategy } from '@/features/auth/strategies/jwt-bearer.strategy';
import { AuthGlobalModule } from '@/global/auth/auth-global.module';

/**
 * Auth 도메인 모듈
 *
 * - OIDC 인증, 토큰 발급/갱신, 로그아웃 비즈니스 로직
 * - JWT 가드/모듈은 global/auth/auth-global.module.ts에서 제공
 */
@Module({
  imports: [AuthGlobalModule, AuditLogModule],
  controllers: [AuthController],
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
  ],
  exports: [AuthService],
})
export class AuthModule {}
