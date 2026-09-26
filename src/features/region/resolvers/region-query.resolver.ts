import { Args, Query, Resolver } from '@nestjs/graphql';

import { SearchRegionsInput } from '@/features/region/dto/inputs/search-regions.input';
import { RegionService } from '@/features/region/services/region.service';
import type {
  RegionGroupOutput,
  RegionOutput,
  RegionSearchResultOutput,
} from '@/features/region/types/region-output.type';

@Resolver('Query')
export class RegionQueryResolver {
  constructor(private readonly regionService: RegionService) {}

  @Query('regionGroups')
  regionGroups(): Promise<RegionGroupOutput[]> {
    return this.regionService.regionGroups();
  }

  @Query('regions')
  regions(@Args('parentId') parentId: string): Promise<RegionOutput[]> {
    return this.regionService.regions(parentId);
  }

  @Query('searchRegions')
  searchRegions(
    @Args('input') input: SearchRegionsInput,
  ): Promise<RegionSearchResultOutput[]> {
    return this.regionService.searchRegions(input);
  }
}
