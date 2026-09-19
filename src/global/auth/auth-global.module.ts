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
      useFactory: (config: ConfigService) => {
        // 키 해석(env b64/파일·prod fail-fast)과 iss/aud는 authConfig가 단일 소스다.
        const auth = config.getOrThrow<AuthConfig>('auth');
        return {
          privateKey: auth.jwtKeys.privateKeyPem,
          publicKey: auth.jwtKeys.publicKeyPem,
          signOptions: {
            algorithm: 'RS256' as const,
            issuer: auth.jwtIssuer,
            audience: auth.jwtAudience,
            keyid: auth.jwtKeys.kid,
            expiresIn: auth.jwtAccessExpiresSeconds,
          },
        };
      },
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
