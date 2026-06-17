/**
 * region resolver 반환용 도메인 출력 타입.
 * SDL(region.types.graphql)의 RegionGroup / Region / RegionSearchResult 와 필드 일치.
 */

export interface RegionGroupOutput {
  id: string;
  name: string;
  slug: string;
  hasChildren: boolean;
}

export interface RegionOutput {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  level: number;
}

export interface RegionSearchResultOutput {
  id: string;
  name: string;
  parentName: string | null;
  level: number;
}
