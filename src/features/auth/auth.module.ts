import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/features/audit-log';
import { AuthService } from '@/features/auth/auth.service';
import { AuthController } from '@/features/auth/controllers/auth.controller';
import { AccountRepository } from '@/features/auth/repositories/account.repository';
import { ACCOUNT_REPOSITORY } from '@/features/auth/repositories/account.repository.interface';
import { RefreshSessionRepository } from '@/features/auth/repositories/refresh-session.repository';
import { REFRESH_SESSION_REPOSITORY } from '@/features/auth/repositories/refresh-session.repository.interface';
import { SellerCredentialRepository } from '@/features/auth/repositories/seller-credential.repository';
import { SELLER_CREDENTIAL_REPOSITORY } from '@/features/auth/repositories/seller-credential.repository.interface';
import { OidcClientService } from '@/features/auth/services/oidc-client.service';
import { OidcLoginService } from '@/features/auth/services/oidc-login.service';
import { OIDC_LOGIN_SERVICE } from '@/features/auth/services/oidc-login.service.interface';
import { SellerCredentialService } from '@/features/auth/services/seller-credential.service';
import { SELLER_CREDENTIAL_SERVICE } from '@/features/auth/services/seller-credential.service.interface';
import { TokenService } from '@/features/auth/services/token.service';
import { TOKEN_SERVICE } from '@/features/auth/services/token.service.interface';
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
    {
      provide: OIDC_LOGIN_SERVICE,
      useClass: OidcLoginService,
    },
    {
      provide: SELLER_CREDENTIAL_SERVICE,
      useClass: SellerCredentialService,
    },
    {
      provide: TOKEN_SERVICE,
      useClass: TokenService,
    },
    {
      provide: ACCOUNT_REPOSITORY,
      useClass: AccountRepository,
    },
    {
      provide: SELLER_CREDENTIAL_REPOSITORY,
      useClass: SellerCredentialRepository,
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
