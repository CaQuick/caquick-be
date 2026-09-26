import { Injectable } from '@nestjs/common';

import { DomainException } from '@/common/errors/error-catalog';
import { parseId } from '@/common/utils/id-parser';
import { DEFAULT_REGION_SEARCH_LIMIT } from '@/features/region/constants/region.constants';
import type { SearchRegionsInput } from '@/features/region/dto/inputs/search-regions.input';
import { RegionRepository } from '@/features/region/repositories/region.repository';
import {
  toRegionGroupOutput,
  toRegionOutput,
  toRegionSearchResultOutput,
} from '@/features/region/services/region-mappers.helper';
import type {
  RegionGroupOutput,
  RegionOutput,
  RegionSearchResultOutput,
} from '@/features/region/types/region-output.type';

@Injectable()
export class RegionService {
  constructor(private readonly repo: RegionRepository) {}

  async regionGroups(): Promise<RegionGroupOutput[]> {
    const rows = await this.repo.findActiveGroups();
    return rows.map(toRegionGroupOutput);
  }

  async regions(parentIdStr: string): Promise<RegionOutput[]> {
    const parentId = parseId(parentIdStr);
    const exists = await this.repo.existsActiveGroup(parentId);
    if (!exists) {
      throw new DomainException('REGION_GROUP_NOT_FOUND');
    }
    const rows = await this.repo.findActiveChildren(parentId);
    return rows.map(toRegionOutput);
  }

  async searchRegions(
    input: SearchRegionsInput,
  ): Promise<RegionSearchResultOutput[]> {
    const keyword = input.keyword.trim();
    if (!keyword) return [];

    const limit = input.limit ?? DEFAULT_REGION_SEARCH_LIMIT;
    const rows = await this.repo.searchActiveByName(keyword, limit);
    return rows.map(toRegionSearchResultOutput);
  }
}
