import { Module } from '@nestjs/common';

import { HealthController } from '@/features/system/health.controller';
import { PingResolver } from '@/features/system/resolvers/ping.resolver';

@Module({
  controllers: [HealthController],
  providers: [PingResolver],
})
export class SystemModule {}
