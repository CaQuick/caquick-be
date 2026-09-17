import type { StoreMapProvider } from '@/generated/prisma/client';

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
