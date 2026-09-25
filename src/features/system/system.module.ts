import { Module } from '@nestjs/common';

import { OutboxModule } from '@/features/outbox';
import { HealthController } from '@/features/system/health.controller';
import { HealthRepository } from '@/features/system/repositories/health.repository';
import { PingResolver } from '@/features/system/resolvers/ping.resolver';
import { HealthService } from '@/features/system/services/health.service';

@Module({
  imports: [OutboxModule],
  controllers: [HealthController],
  providers: [PingResolver, HealthService, HealthRepository],
})
export class SystemModule {}
