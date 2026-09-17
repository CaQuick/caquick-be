import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import type { AuthConfig } from '@/config/auth.config';
import { JwtAuthGuard } from '@/global/auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '@/global/auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '@/global/auth/guards/roles.guard';

@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // 시크릿 해석(폴백·공백·prod fail-fast)은 authConfig가 단일 소스다.
        secret: config.getOrThrow<AuthConfig>('auth').jwtSecret,
      }),
    }),
  ],
  providers: [JwtAuthGuard, OptionalJwtAuthGuard, RolesGuard],
  exports: [
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    RolesGuard,
    PassportModule,
    JwtModule,
  ],
})
export class AuthGlobalModule {}
