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
