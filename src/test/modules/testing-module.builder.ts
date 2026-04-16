import type { ModuleMetadata } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';

import { PrismaService } from '@/prisma/prisma.service';
import { getTestPrismaClient } from '@/test/db/prisma-test-client';

/**
 * 실DB(Testcontainers) Prisma 클라이언트를 PrismaService 위치에 주입한
 * TestingModule을 생성한다.
 *
 * 사용 예:
 * ```ts
 * const { module, prisma } = await createTestingModuleWithRealDb({
 *   providers: [SomeService, SomeRepository],
 * });
 * ```
 */
export async function createTestingModuleWithRealDb(
  metadata: ModuleMetadata,
): Promise<{ module: TestingModule; prisma: PrismaClient }> {
  const prisma = await getTestPrismaClient();

  const module = await Test.createTestingModule({
    ...metadata,
    providers: [
      ...(metadata.providers ?? []),
      {
        provide: PrismaService,
        useValue: prisma,
      },
    ],
  }).compile();

  return { module, prisma };
}
