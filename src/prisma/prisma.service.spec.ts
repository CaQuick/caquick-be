import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import databaseConfig from '@/config/database.config';
import { PrismaModule } from '@/prisma/prisma.module';
import {
  createExtendedPrismaClient,
  PrismaService,
} from '@/prisma/prisma.service';
import {
  disconnectTestPrismaClient,
  getTestDatabaseUrl,
  getTestPrismaClient,
} from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';

// useFactory + abstract class 토큰 패턴 검증 — 주입되는 인스턴스는 factory 반환값이다.
describe('Prisma (real DB)', () => {
  beforeAll(async () => {
    await getTestPrismaClient();
  });

  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('createExtendedPrismaClient', () => {
    it('확장 적용된 Prisma 클라이언트를 반환한다 + 기본 쿼리 동작', async () => {
      const client = createExtendedPrismaClient(getTestDatabaseUrl(), {
        allowPublicKeyRetrieval: true,
      });
      await client.$connect();
      try {
        const count = await client.account.count();
        expect(typeof count).toBe('number');
      } finally {
        await client.$disconnect();
      }
    });

    it('softDelete 확장이 적용되어 deleted_at 이 null 인 row 만 자동 필터한다', async () => {
      const client = createExtendedPrismaClient(getTestDatabaseUrl(), {
        allowPublicKeyRetrieval: true,
      });
      await client.$connect();
      try {
        const active = await client.account.create({
          data: {
            account_type: 'USER',
            status: 'ACTIVE',
            email: 'active@test.com',
            name: 'A',
          },
        });
        await client.account.create({
          data: {
            account_type: 'USER',
            status: 'ACTIVE',
            email: 'deleted@test.com',
            name: 'D',
            deleted_at: new Date(),
          },
        });

        const found = await client.account.findMany({
          where: { email: { in: ['active@test.com', 'deleted@test.com'] } },
        });
        // 자동으로 deleted_at: null 필터가 주입되어 active 만 반환
        expect(found.map((a) => a.id)).toEqual([active.id]);
      } finally {
        await client.$disconnect();
      }
    });
  });

  describe('PrismaModule (라이프사이클 owner)', () => {
    // PrismaModule은 ConfigService('database')에서 URL을 받는다 — 실제 config 경로를 그대로 태운다.
    let originalDatabaseUrl: string | undefined;
    beforeAll(() => {
      originalDatabaseUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = `${getTestDatabaseUrl()}?allowPublicKeyRetrieval=true`;
    });
    afterAll(() => {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
    });
    function compilePrismaModule() {
      return Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [databaseConfig],
          }),
          PrismaModule,
        ],
      }).compile();
    }

    it('모듈 init 시 $connect, destroy 시 $disconnect 가 호출된다', async () => {
      const moduleRef = await compilePrismaModule();
      // compile 단계에서 useFactory 가 즉시 호출되어 클라이언트 인스턴스가 생성된다.

      const prisma = moduleRef.get(PrismaService);
      const connectSpy = jest.spyOn(prisma, '$connect');
      const disconnectSpy = jest.spyOn(prisma, '$disconnect');

      await moduleRef.init();
      expect(connectSpy).toHaveBeenCalledTimes(1);

      await moduleRef.close();
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
    });

    it('PrismaService 토큰으로 주입된 인스턴스는 확장 적용된 클라이언트이다 (account 모델 접근 가능)', async () => {
      const moduleRef = await compilePrismaModule();
      await moduleRef.init();
      try {
        const prisma = moduleRef.get(PrismaService);
        // 확장 클라이언트는 모든 model accessor 를 그대로 노출한다.
        expect(typeof prisma.account.count).toBe('function');
        await prisma.account.count();
      } finally {
        await moduleRef.close();
      }
    });
  });
});
