import { HealthRepository } from '@/features/system/repositories/health.repository';
import { PrismaService } from '@/prisma';
import { disconnectTestPrismaClient } from '@/test/db/prisma-test-client';
import { closeTruncateConnection } from '@/test/db/truncate';
import { createTestingModuleWithRealDb } from '@/test/modules/testing-module.builder';

describe('HealthRepository (real DB)', () => {
  let repo: HealthRepository;

  beforeAll(async () => {
    const { module } = await createTestingModuleWithRealDb({
      providers: [HealthRepository],
    });
    repo = module.get(HealthRepository);
    // 첫 쿼리는 커넥션 수립까지 포함해 부하가 크면 상한(2초)을 넘는다 — 풀을 데운 뒤 '살아 있는 DB'만 본다
    await module.get(PrismaService).$queryRaw`SELECT 1`;
  });
  afterAll(async () => {
    await closeTruncateConnection();
    await disconnectTestPrismaClient();
  });

  it('살아 있는 DB에서는 통과한다', async () => {
    await expect(repo.check()).resolves.toBeUndefined();
  });

  it('반증: 쿼리가 실패하면 그대로 실패로 드러난다', async () => {
    const dead = {
      $queryRaw: () => Promise.reject(new Error('Connection refused')),
    } as unknown as PrismaService;
    await expect(new HealthRepository(dead).check()).rejects.toThrow(
      'Connection refused',
    );
  });
});
