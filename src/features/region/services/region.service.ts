import { Injectable, NotFoundException } from '@nestjs/common';

import { parseId } from '@/common/utils/id-parser';
import {
  DEFAULT_REGION_SEARCH_LIMIT,
  REGION_ERRORS,
} from '@/features/region/constants/region-error-messages';
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

  /** 1차 광역 지역 목록 (전국 포함). */
  async regionGroups(): Promise<RegionGroupOutput[]> {
    const rows = await this.repo.findActiveGroups();
    return rows.map(toRegionGroupOutput);
  }

  /** 특정 1차 지역의 2차 시군구 목록. 존재하지 않는 1차면 404. */
  async regions(parentIdStr: string): Promise<RegionOutput[]> {
    const parentId = parseId(parentIdStr);
    const exists = await this.repo.existsActiveGroup(parentId);
    if (!exists) {
      throw new NotFoundException(REGION_ERRORS.GROUP_NOT_FOUND);
    }
    const rows = await this.repo.findActiveChildren(parentId);
    return rows.map(toRegionOutput);
  }

  /** 지역명 자동검색. 빈 검색어는 빈 배열. */
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
