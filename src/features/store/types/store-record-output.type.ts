import type { StoreMapProvider } from '@/generated/prisma/client';

/** 매장 행 1:1 출력. 판매자(내 매장)·관리자(매장 관리)가 같은 매핑을 쓴다. */
export interface StoreOutput {
  id: string;
  sellerAccountId: string;
  storeName: string;
  storePhone: string;
  addressFull: string;
  addressCity: string | null;
  addressDistrict: string | null;
  addressNeighborhood: string | null;
  regionId: string | null;
  latitude: string | null;
  longitude: string | null;
  mapProvider: StoreMapProvider;
  websiteUrl: string | null;
  businessHoursText: string | null;
  profileImageUrl: string | null;
  greetingMessage: string | null;
  pickupSlotIntervalMinutes: number;
  minLeadTimeMinutes: number;
  maxDaysAhead: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
