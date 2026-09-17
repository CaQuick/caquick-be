import { PrismaClient } from '@/generated/prisma/client';
import {
  createMariaDbAdapter,
  type MariaDbAdapterOptions,
} from '@/prisma/mariadb-adapter';
import { softDeleteExtension } from '@/prisma/soft-delete.middleware';

export function createExtendedPrismaClient(
  databaseUrl: string,
  options: MariaDbAdapterOptions = {},
) {
  return new PrismaClient({
    adapter: createMariaDbAdapter(databaseUrl, options),
  }).$extends(softDeleteExtension);
}

/** NestJS DI 토큰 역할의 abstract class — extends PrismaClient로 model accessor 타입만 노출하고, 실제 인스턴스는 PrismaModule의 useFactory가 만든다. */
export abstract class PrismaService extends PrismaClient {}
