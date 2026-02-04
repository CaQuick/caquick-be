import {
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { softDeleteExtension } from './soft-delete.middleware';

/**
 * Prisma 클라이언트를 NestJS DI 컨테이너에 제공하는 서비스
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super();
    const extended = this.$extends(softDeleteExtension);
    Object.setPrototypeOf(extended, PrismaService.prototype);
    return extended as PrismaService;
  }

  /**
   * 모듈 초기화 시 Prisma 클라이언트 연결
   */
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /**
   * 모듈 종료 시 Prisma 클라이언트 연결 해제
   */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
