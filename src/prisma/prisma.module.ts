import { Global, Module } from '@nestjs/common';

import { PrismaService } from '@/prisma/prisma.service';

/**
 * Prisma 모듈
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
