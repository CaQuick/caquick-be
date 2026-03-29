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

  it('Authorization 헤더가 없으면 GraphQL me 쿼리는 에러를 반환해야 한다', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
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
      data?: { me?: unknown } | null;
      errors?: Array<{
        message: string;
        extensions?: { code?: string };
      }>;
    };

    expect(body.errors).toBeDefined();
    expect(body.errors!.length).toBeGreaterThanOrEqual(1);
    expect(body.data).toBeNull();
  });

  it('잘못된 형식의 JWT가 전달되면 GraphQL me 쿼리는 에러를 반환해야 한다', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', 'Bearer this-is-not-a-valid-jwt')
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
      data?: { me?: unknown } | null;
      errors?: Array<{
        message: string;
        extensions?: { code?: string };
      }>;
    };

    expect(body.errors).toBeDefined();
    expect(body.errors!.length).toBeGreaterThanOrEqual(1);
    expect(body.data).toBeNull();
  });

  it('만료된 JWT가 전달되면 GraphQL me 쿼리는 에러를 반환해야 한다', async () => {
    const expiredToken = jwt.sign(
      { sub: '1', typ: 'access' },
      { expiresIn: '0s' },
    );

    // sign 직후에도 exp가 이미 과거이므로 검증 시 만료 처리됨
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${expiredToken}`)
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
      data?: { me?: unknown } | null;
      errors?: Array<{
        message: string;
        extensions?: { code?: string };
      }>;
    };

    expect(body.errors).toBeDefined();
    expect(body.errors!.length).toBeGreaterThanOrEqual(1);
    expect(body.data).toBeNull();
  });

  it('query 필드가 없는 GraphQL 요청은 에러를 반환해야 한다', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({});

    // Apollo Server는 query 필드가 없으면 400 Bad Request를 반환한다
    expect(response.status).toBe(400);
  });

  it('/health (HEAD) 요청에 200으로 응답해야 한다', async () => {
    await request(app.getHttpServer()).head('/health').expect(200);
  });
});
