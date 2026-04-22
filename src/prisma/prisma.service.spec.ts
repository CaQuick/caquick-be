import { PrismaService } from '@/prisma/prisma.service';
import {
  disconnectTestPrismaClient,
  getTestDatabaseUrl,
  getTestPrismaClient,
} from '@/test/db/prisma-test-client';
import { closeTruncateConnection, truncateAll } from '@/test/db/truncate';

/**
 * PrismaService는 기본 DATABASE_URL을 사용하는 Prisma 클라이언트.
 * 테스트에서는 프로세스의 DATABASE_URL을 test container URL로 치환한 뒤 생성한다.
 */
describe('PrismaService (real DB)', () => {
  let originalDatabaseUrl: string | undefined;

  beforeAll(async () => {
    // test container가 기동되도록 한 번 호출하여 URL 확보
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

  it('onModuleInit이 connect를 수행하고 쿼리 실행이 가능하다', async () => {
    const service = new PrismaService();
    await service.onModuleInit();
    try {
      // softDelete extension이 적용되어 있으면 Account 쿼리가 정상 작동
      const count = await service.account.count();
      expect(typeof count).toBe('number');
    } finally {
      await service.onModuleDestroy();
    }
  });

  it('onModuleDestroy가 disconnect까지 수행한다 (연속 호출해도 throw 없음)', async () => {
    const service = new PrismaService();
    await service.onModuleInit();
    await service.onModuleDestroy();
    // 재호출이 no-op처럼 동작하는지 (Prisma는 idempotent disconnect)
    await expect(service.onModuleDestroy()).resolves.not.toThrow();
  });

  it('생성된 인스턴스에 softDelete extension이 적용되어 있다 (deleted_at 자동 필터)', async () => {
    const service = new PrismaService();
    await service.onModuleInit();
    try {
      // soft-delete된 account를 생성하고 findFirst로는 안 나오는 것을 확인
      const active = await service.account.create({
        data: {
          account_type: 'USER',
          status: 'ACTIVE',
          email: 'active@test.com',
          name: 'A',
        },
      });
      await service.account.create({
        data: {
          account_type: 'USER',
          status: 'ACTIVE',
          email: 'deleted@test.com',
          name: 'D',
          deleted_at: new Date(),
        },
      });

      const found = await service.account.findMany({
        where: { email: { in: ['active@test.com', 'deleted@test.com'] } },
      });
      // softDelete extension이 자동으로 deleted_at: null 필터를 붙이므로 active만 반환
      expect(found.map((a) => a.id)).toEqual([active.id]);
    } finally {
      await service.onModuleDestroy();
    }
  });
});
