import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthService } from './auth.service';
import { AuthController } from './controllers/auth.controller';
import { OidcClientService } from './oidc/oidc-client.service';
import { AuthRepository } from './repositories/auth.repository';
import { JwtCookieStrategy } from './strategies/jwt.strategy';

/**
 * Auth 모듈
 */
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
  controllers: [AuthController],
  providers: [
    AuthService,
    OidcClientService,
    AuthRepository,
    JwtCookieStrategy,
  ],
  exports: [AuthService],
})
export class AuthModule {}
