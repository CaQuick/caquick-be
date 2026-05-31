import { Test } from '@nestjs/testing';

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

/**
 * Prisma 모듈/서비스 — useFactory + class+interface declaration merging 패턴 검증.
 *
 * - createExtendedPrismaClient: 확장(soft-delete) 적용된 PrismaClient 인스턴스 생성
 * - PrismaModule: 인스턴스 라이프사이클 (connect/disconnect) 소유
 * - DI 토큰으로 사용된 PrismaService 클래스 → 실제 주입되는 인스턴스는 factory 반환값
 */
describe('Prisma (real DB)', () => {
  let originalDatabaseUrl: string | undefined;

  beforeAll(async () => {
    // test container 기동 + DATABASE_URL 치환 (createExtendedPrismaClient 가 이 URL 을 사용)
    await getTestPrismaClient();
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = getTestDatabaseUrl();
  });

  afterAll(async () => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('createExtendedPrismaClient', () => {
    it('확장 적용된 Prisma 클라이언트를 반환한다 + 기본 쿼리 동작', async () => {
      const client = createExtendedPrismaClient();
      await client.$connect();
      try {
        const count = await client.account.count();
        expect(typeof count).toBe('number');
      } finally {
        await client.$disconnect();
      }
    });

    it('softDelete 확장이 적용되어 deleted_at 이 null 인 row 만 자동 필터한다', async () => {
      const client = createExtendedPrismaClient();
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
    it('모듈 init 시 $connect, destroy 시 $disconnect 가 호출된다', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [PrismaModule],
      }).compile();
      // compile 단계에서 useFactory 가 즉시 호출되어 클라이언트 인스턴스가 생성된다.

      const prisma = moduleRef.get(PrismaService);
      const connectSpy = jest.spyOn(prisma, '$connect');
      const disconnectSpy = jest.spyOn(prisma, '$disconnect');

      // init/close 를 호출하면 모듈 라이프사이클 훅이 동작한다.
      await moduleRef.init();
      expect(connectSpy).toHaveBeenCalledTimes(1);

      await moduleRef.close();
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
    });

    it('PrismaService 토큰으로 주입된 인스턴스는 확장 적용된 클라이언트이다 (account 모델 접근 가능)', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [PrismaModule],
      }).compile();
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
