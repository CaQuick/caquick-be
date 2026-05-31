import {
  Global,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import {
  createExtendedPrismaClient,
  PrismaService,
} from '@/prisma/prisma.service';

/**
 * Prisma 모듈.
 *
 * - PrismaService 토큰은 useFactory 로 확장(soft-delete) 적용된 PrismaClient 인스턴스를 제공한다.
 * - 클라이언트의 connect/disconnect 라이프사이클은 본 모듈이 소유한다.
 */
@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: createExtendedPrismaClient,
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
