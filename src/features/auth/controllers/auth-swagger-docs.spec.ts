import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { AuthService } from '@/features/auth/auth.service';
import { AuthController } from '@/features/auth/controllers/auth.controller';
import { JwksController } from '@/features/auth/controllers/jwks.controller';
import { CredentialAuthService } from '@/features/auth/services/credential-auth.service';
import { OidcLoginService } from '@/features/auth/services/oidc-login.service';
import { TEST_AUTH_CONFIG } from '@/test/auth-config';

/** 공용 데코레이터 묶음이 operation의 summary·description·security·response 스키마를 바꾸지 않는지 스냅샷으로 고정한다(JWKS 포함 14개). */
describe('Auth REST Swagger 문서', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController, JwksController],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: OidcLoginService, useValue: {} },
        { provide: CredentialAuthService, useValue: {} },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => TEST_AUTH_CONFIG },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('auth REST operation 14개(JWKS 포함)의 문서가 스냅샷과 같다', () => {
    // main.ts와 같은 보안 스킴 이름(access-token·refresh-cookie)으로 문서를 만든다
    const config = new DocumentBuilder()
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token',
      )
      .addCookieAuth(
        'caquick_rt',
        { type: 'apiKey', in: 'cookie' },
        'refresh-cookie',
      )
      .build();
    const document = SwaggerModule.createDocument(app, config);

    const paths = Object.keys(document.paths).sort();
    expect(paths).toHaveLength(14);
    expect(document.paths).toMatchSnapshot();
  });
});
