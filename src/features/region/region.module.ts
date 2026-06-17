import { Module } from '@nestjs/common';

import { RegionRepository } from '@/features/region/repositories/region.repository';
import { RegionQueryResolver } from '@/features/region/resolvers/region-query.resolver';
import { RegionService } from '@/features/region/services/region.service';

@Module({
  providers: [RegionRepository, RegionService, RegionQueryResolver],
  exports: [RegionRepository],
})
export class RegionModule {}
