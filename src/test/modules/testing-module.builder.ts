import type { ModuleMetadata } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';

import { RequestContextService } from '@/global/request-context';
import { S3Service } from '@/global/storage/s3.service';
import { PrismaService } from '@/prisma/prisma.service';
import { getTestPrismaClient } from '@/test/db/prisma-test-client';
import { createS3ServiceMock } from '@/test/mocks/s3-service.mock';

/**
 * 실DB(Testcontainers) Prisma 클라이언트를 PrismaService 위치에 주입한
 * TestingModule을 생성한다.
 *
 * `RequestContextService`(ALS)도 기본 제공한다 — AuditLogRepository 등 요청
 * 컨텍스트를 주입받는 provider 가 어디서나 resolve 되도록. run() 밖이면 빈 컨텍스트라
 * 기존 동작(ip/ua null)에 영향 없다.
 *
 * `S3Service`는 기본 목으로 제공한다 — 외부 부수효과 어댑터라 실물을 띄울 수 없고,
 * 업로드 URL 소유권 검증이 여러 도메인 서비스에 퍼져 있어 spec마다 목을 다시 엮으면
 * 새 주입처가 생길 때마다 무관한 spec 이 무더기로 깨진다.
 * 기본 목은 **spread 앞**에 둬서, 목의 동작을 검증하는 spec 이 직접 넘긴 provider 가
 * 항상 이긴다(뒤에 등록된 provider 가 우선).
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
      { provide: S3Service, useValue: createS3ServiceMock() },
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
