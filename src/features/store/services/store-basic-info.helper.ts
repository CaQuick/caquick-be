import {
  LATITUDE_RANGE,
  LONGITUDE_RANGE,
  parseDecimalOrNull,
} from '@/common/utils/decimal-parser';
import {
  cleanNullableText,
  cleanRequiredText,
} from '@/common/utils/text-cleaner';
import {
  MAX_ADDRESS_CITY_LENGTH,
  MAX_ADDRESS_DISTRICT_LENGTH,
  MAX_ADDRESS_FULL_LENGTH,
  MAX_ADDRESS_NEIGHBORHOOD_LENGTH,
  MAX_BUSINESS_HOURS_TEXT_LENGTH,
  MAX_GREETING_MESSAGE_LENGTH,
  MAX_STORE_NAME_LENGTH,
  MAX_STORE_PHONE_LENGTH,
  MAX_STORE_URL_LENGTH,
} from '@/features/store/constants/store-field-limits';
import type { Prisma, StoreMapProvider } from '@/generated/prisma/client';

/**
 * 매장 기본 정보 부분 수정 입력. undefined는 유지, null/빈 문자열은 제거(nullable 컬럼).
 * 판매자(내 매장)와 관리자(대리 수정)가 같은 규칙을 탄다.
 */
export interface StoreBasicInfoPatch {
  storeName?: string;
  storePhone?: string;
  addressFull?: string;
  addressCity?: string | null;
  addressDistrict?: string | null;
  addressNeighborhood?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  mapProvider?: StoreMapProvider | null;
  websiteUrl?: string | null;
  businessHoursText?: string | null;
  profileImageUrl?: string | null;
  greetingMessage?: string | null;
}

/**
 * 전달된 필드만 Prisma update 데이터로 만든다(DI-free 순수 함수).
 * 길이 초과·필수 공백·좌표 형식 오류는 400(DomainException).
 */
export function buildStoreBasicInfoUpdateData(
  input: StoreBasicInfoPatch,
): Prisma.StoreUpdateInput {
  return {
    ...(input.storeName !== undefined
      ? {
          store_name: cleanRequiredText(input.storeName, MAX_STORE_NAME_LENGTH),
        }
      : {}),
    ...(input.storePhone !== undefined
      ? {
          store_phone: cleanRequiredText(
            input.storePhone,
            MAX_STORE_PHONE_LENGTH,
          ),
        }
      : {}),
    ...(input.addressFull !== undefined
      ? {
          address_full: cleanRequiredText(
            input.addressFull,
            MAX_ADDRESS_FULL_LENGTH,
          ),
        }
      : {}),
    ...(input.addressCity !== undefined
      ? {
          address_city: cleanNullableText(
            input.addressCity,
            MAX_ADDRESS_CITY_LENGTH,
          ),
        }
      : {}),
    ...(input.addressDistrict !== undefined
      ? {
          address_district: cleanNullableText(
            input.addressDistrict,
            MAX_ADDRESS_DISTRICT_LENGTH,
          ),
        }
      : {}),
    ...(input.addressNeighborhood !== undefined
      ? {
          address_neighborhood: cleanNullableText(
            input.addressNeighborhood,
            MAX_ADDRESS_NEIGHBORHOOD_LENGTH,
          ),
        }
      : {}),
    ...(input.latitude !== undefined
      ? {
          latitude: parseDecimalOrNull(input.latitude, LATITUDE_RANGE),
        }
      : {}),
    ...(input.longitude !== undefined
      ? {
          longitude: parseDecimalOrNull(input.longitude, LONGITUDE_RANGE),
        }
      : {}),
    ...(input.mapProvider !== undefined && input.mapProvider !== null
      ? { map_provider: input.mapProvider }
      : {}),
    ...(input.websiteUrl !== undefined
      ? {
          website_url: cleanNullableText(
            input.websiteUrl,
            MAX_STORE_URL_LENGTH,
          ),
        }
      : {}),
    ...(input.businessHoursText !== undefined
      ? {
          business_hours_text: cleanNullableText(
            input.businessHoursText,
            MAX_BUSINESS_HOURS_TEXT_LENGTH,
          ),
        }
      : {}),
    // 프로필(로고) 이미지. null/빈 문자열 전달 시 제거, 미전달(undefined) 시 유지.
    ...(input.profileImageUrl !== undefined
      ? {
          profile_image_url: cleanNullableText(
            input.profileImageUrl,
            MAX_STORE_URL_LENGTH,
          ),
        }
      : {}),
    // 빈 문자열은 null 저장 → 문의 채팅에서 서버 기본 인사말로 되돌아간다
    ...(input.greetingMessage !== undefined
      ? {
          greeting_message: cleanNullableText(
            input.greetingMessage,
            MAX_GREETING_MESSAGE_LENGTH,
          ),
        }
      : {}),
  };
}
