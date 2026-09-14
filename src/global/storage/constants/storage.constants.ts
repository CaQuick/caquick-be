import type {
  UploadPolicy,
  UploadPurpose,
} from '@/global/storage/types/storage.types';

/**
 * 업로드 목적별 정책
 */
export const UPLOAD_POLICIES: Record<UploadPurpose, UploadPolicy> = {
  PROFILE_IMAGE: {
    keyPrefix: 'profile-images',
    maxSizeBytes: 5 * 1024 * 1024, // 5MB
    allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  REVIEW_IMAGE: {
    keyPrefix: 'review-media/images',
    maxSizeBytes: 10 * 1024 * 1024, // 10MB
    allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  REVIEW_VIDEO: {
    keyPrefix: 'review-media/videos',
    maxSizeBytes: 50 * 1024 * 1024, // 50MB
    allowedContentTypes: ['video/mp4', 'video/quicktime'],
  },
  PRODUCT_IMAGE: {
    keyPrefix: 'product-images',
    maxSizeBytes: 10 * 1024 * 1024, // 10MB — 상품 상세 이미지는 프로필보다 크다
    allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  STORE_IMAGE: {
    keyPrefix: 'store-images',
    maxSizeBytes: 5 * 1024 * 1024, // 5MB
    allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  BANNER_IMAGE: {
    keyPrefix: 'banner-images',
    maxSizeBytes: 10 * 1024 * 1024, // 10MB — 와이드 배너
    allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
} as const;

/**
 * 동적 조립이 필요한 스토리지 에러 문구.
 * 고정 문구는 common/errors 카탈로그로 옮겼다 — 여기 남은 둘은 허용 타입 목록·
 * 최대 용량이 purpose마다 달라 런타임에 붙는다.
 */
const STORAGE_ERRORS = {
  INVALID_CONTENT_TYPE: '허용되지 않은 파일 형식입니다.',
  FILE_TOO_LARGE: '파일 용량이 허용 한도를 초과했습니다.',
} as const;

export function invalidContentTypeMessage(
  allowedTypes: readonly string[],
): string {
  return `${STORAGE_ERRORS.INVALID_CONTENT_TYPE} (허용: ${allowedTypes.join(', ')})`;
}

export function fileTooLargeMessage(maxMB: number): string {
  return `${STORAGE_ERRORS.FILE_TOO_LARGE} (최대 ${maxMB.toString()}MB)`;
}
