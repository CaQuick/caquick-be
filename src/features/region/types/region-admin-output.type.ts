export interface AdminRegionOutput {
  id: string;
  parentId: string | null;
  level: number;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  centerLat: string | null;
  centerLng: string | null;
  storeCount: number;
  childCount: number;
  createdAt: Date;
  updatedAt: Date;
}
