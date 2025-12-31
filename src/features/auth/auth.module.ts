import { Module } from '@nestjs/common';

import { AuthGlobalModule } from '../../global/auth/auth-global.module';

import { AuthService } from './auth.service';
import { AuthController } from './controllers/auth.controller';
import { OidcClientService } from './oidc/oidc-client.service';
import { AuthRepository } from './repositories/auth.repository';

/**
 * Auth 도메인 모듈
 *
 * - OIDC 인증, 토큰 발급/갱신, 로그아웃 비즈니스 로직
 * - JWT 인증 인프라는 global/auth/auth-global.module.ts에 위치
 */
@Module({
  imports: [AuthGlobalModule],
  controllers: [AuthController],
  providers: [AuthService, OidcClientService, AuthRepository],
  exports: [AuthService],
})
export class AuthModule {}
