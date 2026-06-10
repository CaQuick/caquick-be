import { PrismaClient } from '@prisma/client';

import { softDeleteExtension } from '@/prisma/soft-delete.middleware';

/**
 * 확장(soft-delete) 이 적용된 Prisma 클라이언트를 생성한다.
 *
 * NestJS provider 의 `useFactory` 로 호출되어 단일 인스턴스를 만든다.
 * 라이프사이클(connect/disconnect) 은 PrismaModule 이 owner.
 */
export function createExtendedPrismaClient() {
  return new PrismaClient().$extends(softDeleteExtension);
}

/**
 * NestJS DI 토큰 역할의 abstract class.
 *
 * - `new PrismaService()` 호출은 abstract 라 compile error → 잘못된 인스턴스화 원천 차단
 * - `extends PrismaClient` 로 model accessor 등 API 타입을 그대로 노출
 *   → callsite 는 `prisma.account.findMany(...)` 등을 그대로 사용
 * - 실제 주입되는 인스턴스는 PrismaModule 의 `useFactory` 가 반환한 `createExtendedPrismaClient()` 결과
 */
export abstract class PrismaService extends PrismaClient {}
