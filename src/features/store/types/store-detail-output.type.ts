export interface StoreDetail {
  id: string;
  storeName: string;
  regionLabel: string | null;
  ratingAverage: number;
  reviewCount: number;
  isWishlisted: boolean;
  images: string[];
  phoneNumber: string;
  addressFull: string;
  latitude: number | null;
  longitude: number | null;
  mapProvider: 'NAVER' | 'KAKAO' | 'NONE';
  businessHoursText: string | null;
  regularClosureText: string | null;
  accessGuideText: string | null;
  websiteUrl: string | null;
}
