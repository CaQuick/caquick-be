import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { AuthService } from '@/features/auth/auth.service';
import { AuthController } from '@/features/auth/controllers/auth.controller';
import { CredentialAuthService } from '@/features/auth/services/credential-auth.service';
import { OidcLoginService } from '@/features/auth/services/oidc-login.service';

/** 데코레이터를 묶음으로 추출해도 13개 operation의 summary·description·security·response 스키마가 바뀌지 않아야 한다 — 스냅샷은 추출 전 코드로 생성했다. */
describe('Auth REST Swagger 문서', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: OidcLoginService, useValue: {} },
        { provide: CredentialAuthService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/auth/* operation 13개의 문서가 스냅샷과 같다', () => {
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
    expect(paths).toHaveLength(13);
    expect(document.paths).toMatchSnapshot();
  });
});
