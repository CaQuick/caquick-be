import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BadRequestException,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { ValidationError } from 'class-validator';
import {
  buildSchema,
  getNamedType,
  type GraphQLFormattedError,
  type GraphQLInputObjectType,
  type GraphQLInputType,
  type GraphQLSchema,
  isEnumType,
  isInputObjectType,
  isLeafType,
  isListType,
  isNonNullType,
} from 'graphql';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '@/app.module';
import type { PrismaClient } from '@/generated/prisma/client';
import { TokenBlacklistService } from '@/global/auth/blacklist';
import { HttpExceptionFilter } from '@/global/filters/global-exception.filter';
import { GraphQLExceptionFilter } from '@/global/filters/graphql-exception.filter';
import { CustomLoggerService } from '@/global/logger/custom-logger.service';
import { MetricsService } from '@/global/metrics';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { getTestRedisUrl } from '@/test/db/redis-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';
import { createAccount } from '@/test/factories';
import { listenOnLoopback } from '@/test/http-app';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

// 관리자 FE는 '전체' 필터를 필드 생략이 아니라 null로 보낸다. nullable 입력의 null이 Prisma where까지 내려가면
// "Argument must not be null"로 500이 난다(매장·상품·배너 isActive, 알림 이력 type·targetKind). 입력 공간은 SDL에서 읽어
// admin 접두 Query 전수에 nullable 필드를 전부 null로 채워 실제 앱(파이프·필터·가드·실DB)으로 보낸다.

const FEATURES_DIR = join(__dirname, '..', 'features');
const ADMIN_QUERY_COUNT = 17;

/** 필수 스칼라의 최소 유효값. 새 스칼라가 필수 필드로 오면 표에 없다고 던져 결정을 강제한다 */
const MINIMAL_SCALARS: Record<string, unknown> = {
  ID: '1',
  String: 'x',
  Int: 1,
  Float: 1,
  Boolean: false,
  DateTime: '2026-01-01T00:00:00.000Z',
};

function collectSdl(dir: string): string {
  return readdirSync(dir, { withFileTypes: true })
    .map((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return collectSdl(full);
      return entry.name.endsWith('.graphql') ? readFileSync(full, 'utf8') : '';
    })
    .join('\n');
}

/** nullable은 종류와 무관하게 null, 필수는 최소 유효값(입력 객체는 재귀) */
function minimalValue(type: GraphQLInputType): unknown {
  if (!isNonNullType(type)) return null;
  const inner = type.ofType;
  if (isListType(inner)) return [];
  if (isEnumType(inner)) return inner.getValues()[0].name;
  if (isInputObjectType(inner)) return nullFilledInput(inner);
  if (!(inner.name in MINIMAL_SCALARS)) {
    throw new Error(
      `필수 스칼라 ${inner.name}의 최소값이 MINIMAL_SCALARS에 없다`,
    );
  }
  return MINIMAL_SCALARS[inner.name];
}

function nullFilledInput(
  type: GraphQLInputObjectType,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.values(type.getFields()).map((f) => [f.name, minimalValue(f.type)]),
  );
}

interface NullInputCase {
  field: string;
  query: string;
  /** 입력 객체 인자는 필드를 null로 채운 객체, 나머지 인자는 minimalValue */
  fieldsNull: Record<string, unknown>;
  /** nullable 입력 객체 인자 자체를 null로. 그런 인자가 없으면 null */
  argNull: Record<string, unknown> | null;
}

function adminNullInputCases(schema: GraphQLSchema): NullInputCase[] {
  return Object.values(schema.getQueryType()?.getFields() ?? {})
    .filter(
      (f) =>
        f.name.startsWith('admin') &&
        f.args.some((a) => isInputObjectType(getNamedType(a.type))),
    )
    .map((f) => {
      const defs = f.args.map((a) => `$${a.name}: ${String(a.type)}`);
      const uses = f.args.map((a) => `${a.name}: $${a.name}`);
      const selection = isLeafType(getNamedType(f.type))
        ? ''
        : ' { __typename }';
      const fieldsNull = Object.fromEntries(
        f.args.map((a) => {
          const named = getNamedType(a.type);
          return [
            a.name,
            isInputObjectType(named)
              ? nullFilledInput(named)
              : minimalValue(a.type),
          ];
        }),
      );
      const nullableInputArgs = f.args.filter(
        (a) => !isNonNullType(a.type) && isInputObjectType(a.type),
      );
      return {
        field: f.name,
        query: `query(${defs.join(', ')}) { ${f.name}(${uses.join(', ')})${selection} }`,
        fieldsNull,
        argNull:
          nullableInputArgs.length === 0
            ? null
            : {
                ...fieldsNull,
                ...Object.fromEntries(
                  nullableInputArgs.map((a) => [a.name, null]),
                ),
              },
      };
    });
}

interface GraphQLBody {
  data?: Record<string, unknown> | null;
  errors?: GraphQLFormattedError[];
}

/** 판정: HTTP 5xx, 또는 응답 오류 중 INTERNAL_ERROR·statusCode 5xx */
function serverErrorsOf(status: number, body: GraphQLBody): string[] {
  const found = status >= 500 ? [`HTTP ${status}`] : [];
  for (const error of body.errors ?? []) {
    const code = error.extensions?.code;
    const statusCode = error.extensions?.statusCode;
    if (
      code === 'INTERNAL_ERROR' ||
      (typeof statusCode === 'number' && statusCode >= 500)
    ) {
      found.push(`${String(code)}(${String(statusCode)}): ${error.message}`);
    }
  }
  return found;
}

const ENV: Record<string, string> = {
  // PrismaService는 실DB 테스트 클라이언트로 override — 설정 검증만 통과시킨다
  DATABASE_URL: 'mysql://unused:unused@localhost:3306/unused',
  RABBITMQ_URL: 'amqp://guest:guest@localhost:5672',
  OIDC_GOOGLE_ISSUER_URL: 'https://accounts.google.com',
  OIDC_GOOGLE_CLIENT_ID: 'gate',
  OIDC_GOOGLE_CLIENT_SECRET: 'gate',
  OIDC_KAKAO_ISSUER_URL: 'https://kauth.kakao.com',
  OIDC_KAKAO_CLIENT_ID: 'gate',
  OIDC_KAKAO_CLIENT_SECRET: 'gate',
  OUTBOX_DISPATCH_ENABLED: 'false',
};

describe('관리자 Query nullable 입력 null 전수 (real DB)', () => {
  const cases = adminNullInputCases(buildSchema(collectSdl(FEATURES_DIR)));
  const restored: Array<[string, string | undefined]> = [];
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let token: string;

  beforeAll(async () => {
    for (const [key, value] of Object.entries({
      ...ENV,
      REDIS_URL: getTestRedisUrl(),
    })) {
      restored.push([key, process.env[key]]);
      process.env[key] = value;
    }
    const { module, prisma: p } = await createTestingModuleWithRealDb({
      imports: [AppModule.forRole('api')],
    });
    prisma = p;
    app = module.createNestApplication<INestApplication<App>>();
    // main.ts와 같은 전역 파이프·필터 — 응답 코드가 운영과 같아야 판정이 맞다
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: (errors: ValidationError[]) =>
          new BadRequestException({
            message: errors.map((e) => ({
              property: e.property,
              constraints: e.constraints ?? {},
            })),
          }),
      }),
    );
    const logger = app.get(CustomLoggerService);
    app.useGlobalFilters(
      new HttpExceptionFilter(
        app.get(HttpAdapterHost).httpAdapter,
        logger,
        new GraphQLExceptionFilter(logger, app.get(MetricsService)),
      ),
    );
    await listenOnLoopback(app);
  });

  afterAll(async () => {
    await app?.close();
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
    for (const [key, value] of restored) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(async () => {
    await truncateAll();
    // 블랙리스트 정상 경로(표식 있음) — 미구축이면 DB 폴백과 경보로 빠진다
    const blacklist = app.get(TokenBlacklistService);
    await blacklist.markReady(await blacklist.generation());
    const admin = await createAccount(prisma, { account_type: 'ADMIN' });
    token = app
      .get(JwtService)
      .sign({ sub: admin.id.toString(), typ: 'access', role: 'ADMIN' });
  });

  async function post(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<{ status: number; body: GraphQLBody }> {
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query, variables });
    return {
      status: res.status,
      body: res.body as GraphQLBody,
    };
  }

  it(`input 객체 인자를 받는 admin 접두 Query는 ${ADMIN_QUERY_COUNT}개다(표가 비거나 모르게 늘지 않는다)`, () => {
    expect(cases.map((c) => c.field)).toHaveLength(ADMIN_QUERY_COUNT);
  });

  it.each(cases)(
    '$field: nullable 필드를 전부 null로 보내도 5xx·INTERNAL_ERROR가 없다',
    async ({ field, query, fieldsNull }) => {
      const { status, body } = await post(query, fieldsNull);
      expect(serverErrorsOf(status, body)).toEqual([]);
      // 인증·검증에서 막혀 리졸버에 닿지 않은 응답은 통과로 치지 않는다
      expect(body).toEqual({ data: { [field]: expect.anything() } });
    },
  );

  it.each(cases.filter((c) => c.argNull !== null))(
    '$field: nullable input 인자 자체를 null로 보내도 5xx·INTERNAL_ERROR가 없다',
    async ({ field, query, argNull }) => {
      const { status, body } = await post(query, argNull!);
      expect(serverErrorsOf(status, body)).toEqual([]);
      expect(body).toEqual({ data: { [field]: expect.anything() } });
    },
  );

  describe('검출기 반증', () => {
    it('입력 오류는 같은 경로에서 VALIDATION_FAILED(400)로 나가 판정에 걸리지 않는다(파이프·필터 배선 대조)', async () => {
      const target = cases.find(
        (c) => c.field === 'adminNotificationBroadcasts',
      )!;
      const { status, body } = await post(target.query, {
        input: { limit: 0 },
      });
      expect(body.errors?.[0]?.extensions).toMatchObject({
        code: 'VALIDATION_FAILED',
        statusCode: 400,
      });
      expect(serverErrorsOf(status, body)).toEqual([]);
    });

    it('판정기는 INTERNAL_ERROR·statusCode 5xx·HTTP 5xx를 잡고 4xx는 넘긴다', () => {
      const error = (code: string, statusCode: number) => ({
        message: 'm',
        extensions: { code, statusCode },
      });
      expect(
        serverErrorsOf(200, { errors: [error('INTERNAL_ERROR', 500)] }),
      ).toHaveLength(1);
      expect(
        serverErrorsOf(200, { errors: [error('SOMETHING', 503)] }),
      ).toHaveLength(1);
      expect(serverErrorsOf(502, {})).toEqual(['HTTP 502']);
      expect(
        serverErrorsOf(200, {
          errors: [error('VALIDATION_FAILED', 400), error('ADMIN_ONLY', 403)],
        }),
      ).toEqual([]);
    });

    it('입력 생성기는 nullable 필드를 종류와 무관하게 null로, 필수 필드를 최소값으로 채운다', () => {
      const generated = adminNullInputCases(
        buildSchema(`
          scalar DateTime
          enum Kind { A B }
          input Nested { at: DateTime! }
          input SampleInput {
            limit: Int = 20
            kind: Kind
            flag: Boolean = false
            ids: [ID!]
            nested: Nested
            requiredKind: Kind!
            requiredNested: Nested!
          }
          type Page { total: Int! }
          type Query {
            adminSample(input: SampleInput): Page!
            adminScalarOnly(id: ID!): Int
            sellerSample(input: SampleInput): Page!
          }
        `),
      );
      // admin 접두가 아니거나 input 객체 인자가 없는 필드는 빠진다
      expect(generated).toEqual([
        {
          field: 'adminSample',
          query:
            'query($input: SampleInput) { adminSample(input: $input) { __typename } }',
          fieldsNull: {
            input: {
              limit: null,
              kind: null,
              flag: null,
              ids: null,
              nested: null,
              requiredKind: 'A',
              requiredNested: { at: '2026-01-01T00:00:00.000Z' },
            },
          },
          argNull: { input: null },
        },
      ]);
    });

    it('필수 필드에 표에 없는 스칼라가 오면 던진다', () => {
      expect(() =>
        adminNullInputCases(
          buildSchema(`
            scalar Money
            input MoneyInput { amount: Money! }
            type Query { adminMoney(input: MoneyInput): Int }
          `),
        ),
      ).toThrow('필수 스칼라 Money의 최소값이 MINIMAL_SCALARS에 없다');
    });
  });
});
