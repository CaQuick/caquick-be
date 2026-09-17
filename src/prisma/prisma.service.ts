import { PrismaClient } from '@/generated/prisma/client';
import { createMariaDbAdapter } from '@/prisma/mariadb-adapter';
import { softDeleteExtension } from '@/prisma/soft-delete.middleware';

/**
 * 확장(soft-delete)이 적용된 Prisma 클라이언트를 생성한다.
 * PrismaModule의 useFactory가 호출해 단일 인스턴스를 만들고 라이프사이클을 소유한다.
 */
export function createExtendedPrismaClient(
  databaseUrl: string,
  options: { allowPublicKeyRetrieval?: boolean } = {},
) {
  return new PrismaClient({
    adapter: createMariaDbAdapter(databaseUrl, options),
  }).$extends(softDeleteExtension);
}

/**
 * NestJS DI 토큰 역할의 abstract class.
 * `extends PrismaClient`로 model accessor 타입을 그대로 노출하고, 실제 인스턴스는
 * PrismaModule의 useFactory가 반환한 createExtendedPrismaClient() 결과다.
 */
export abstract class PrismaService extends PrismaClient {}
