import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { JwtAuthGuard } from './guards/jwt-auth.guard';

/**
 * 전역 인증 인프라 모듈
 *
 * - JWT 가드, 데코레이터, 모듈 설정 제공
 * - 모든 도메인에서 인증 기능 사용 가능
 */
@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_ACCESS_SECRET');
        if (!secret || secret.trim().length === 0) {
          throw new Error('Missing JWT_ACCESS_SECRET');
        }
        return { secret };
      },
    }),
  ],
  providers: [JwtAuthGuard],
  exports: [JwtAuthGuard, PassportModule, JwtModule],
})
export class AuthGlobalModule {}
