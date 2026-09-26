import { Module } from '@nestjs/common';

import { AuditLogModule } from '@/features/audit-log';
import { AuthModule } from '@/features/auth';
import { RegionAdminRepository } from '@/features/region/repositories/region-admin.repository';
import { RegionRepository } from '@/features/region/repositories/region.repository';
import { AdminRegionMutationResolver } from '@/features/region/resolvers/region-admin-mutation.resolver';
import { AdminRegionQueryResolver } from '@/features/region/resolvers/region-admin-query.resolver';
import { RegionQueryResolver } from '@/features/region/resolvers/region-query.resolver';
import { AdminRegionService } from '@/features/region/services/region-admin.service';
import { RegionService } from '@/features/region/services/region.service';

@Module({
  // 관리자 지역 마스터 CRUD: 관리자 컨텍스트(AuthModule)·감사 기록(AuditLogModule)
  imports: [AuthModule, AuditLogModule],
  providers: [
    RegionRepository,
    RegionService,
    RegionQueryResolver,
    RegionAdminRepository,
    AdminRegionService,
    AdminRegionQueryResolver,
    AdminRegionMutationResolver,
  ],
})
export class RegionModule {}
