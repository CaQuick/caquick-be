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
  // 판매자·관리자 이미지는 프로필 이미지와 같은 정책(5MB, jpeg/png/webp)
  PRODUCT_IMAGE: {
    keyPrefix: 'product-images',
    maxSizeBytes: 5 * 1024 * 1024,
    allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  STORE_IMAGE: {
    keyPrefix: 'store-images',
    maxSizeBytes: 5 * 1024 * 1024,
    allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  BANNER_IMAGE: {
    keyPrefix: 'banner-images',
    maxSizeBytes: 5 * 1024 * 1024,
    allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
} as const;
