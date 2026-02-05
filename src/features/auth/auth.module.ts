import { Module } from '@nestjs/common';

import { AuthGlobalModule } from '../../global/auth/auth-global.module';

import { AuthService } from './auth.service';
import { AuthController } from './controllers/auth.controller';
import { AuthRepository } from './repositories/auth.repository';
import { OidcClientService } from './services/oidc-client.service';
import { JwtBearerStrategy } from './strategies/jwt-bearer.strategy';

/**
 * Auth 도메인 모듈
 *
 * - OIDC 인증, 토큰 발급/갱신, 로그아웃 비즈니스 로직
 * - JWT 가드/모듈은 global/auth/auth-global.module.ts에서 제공
 */
@Module({
  imports: [AuthGlobalModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    OidcClientService,
    AuthRepository,
    JwtBearerStrategy,
  ],
  exports: [AuthService],
})
export class AuthModule {}
