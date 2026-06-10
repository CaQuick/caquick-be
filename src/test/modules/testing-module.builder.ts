import type { ModuleMetadata } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';

import { RequestContextService } from '@/global/request-context';
import { PrismaService } from '@/prisma/prisma.service';
import { getTestPrismaClient } from '@/test/db/prisma-test-client';

/**
 * 실DB(Testcontainers) Prisma 클라이언트를 PrismaService 위치에 주입한
 * TestingModule을 생성한다.
 *
 * `RequestContextService`(ALS)도 기본 제공한다 — AuditLogRepository 등 요청
 * 컨텍스트를 주입받는 provider 가 어디서나 resolve 되도록. run() 밖이면 빈 컨텍스트라
 * 기존 동작(ip/ua null)에 영향 없다.
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
      RequestContextService,
    ],
  }).compile();

  return { module, prisma };
}
