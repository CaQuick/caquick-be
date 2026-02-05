import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountType } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';
import { AuthRepository } from './../src/features/auth/repositories/auth.repository';
import { UserRepository } from './../src/features/user/repositories/user.repository';
import { PrismaService } from './../src/prisma';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;
  let originalJwtSecret: string | undefined;
  const mockAuthRepository = {
    findAccountForJwt: jest.fn().mockResolvedValue({
      id: BigInt(1),
      status: 'ACTIVE',
    }),
  };
  const mockUserRepository = {
    findAccountWithProfile: jest.fn().mockResolvedValue({
      id: BigInt(1),
      account_type: AccountType.USER,
      email: 'test@example.com',
      name: 'Test User',
      deleted_at: null,
      user_profile: {
        nickname: 'tester',
        birth_date: null,
        phone_number: null,
        profile_image_url: null,
        onboarding_completed_at: null,
        deleted_at: null,
      },
    }),
  };
  const mockPrismaService = {
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
  };

  beforeAll(async () => {
    originalJwtSecret = process.env.JWT_ACCESS_SECRET;
    process.env.JWT_ACCESS_SECRET = 'test_jwt_secret';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthRepository)
      .useValue(mockAuthRepository)
      .overrideProvider(UserRepository)
      .useValue(mockUserRepository)
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    jwt = moduleFixture.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
    if (originalJwtSecret === undefined) {
      delete process.env.JWT_ACCESS_SECRET;
      return;
    }
    process.env.JWT_ACCESS_SECRET = originalJwtSecret;
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('GraphQL me는 인증이 통과되어야 한다', async () => {
    const accessToken = jwt.sign({
      sub: '1',
      typ: 'access',
    });

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        query: `
          query Me {
            me {
              accountId
              email
            }
          }
        `,
      })
      .expect(200);

    const body = response.body as {
      data?: {
        me?: {
          accountId: string;
          email: string | null;
        };
      };
      errors?: unknown;
    };

    expect(body.errors).toBeUndefined();
    expect(body.data).toEqual({
      me: {
        accountId: '1',
        email: 'test@example.com',
      },
    });
  });
});
