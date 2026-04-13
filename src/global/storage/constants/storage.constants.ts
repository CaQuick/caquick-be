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
} as const;

/**
 * 스토리지 에러 메시지
 */
export const STORAGE_ERRORS = {
  INVALID_CONTENT_TYPE: '허용되지 않은 파일 형식입니다.',
  FILE_TOO_LARGE: '파일 용량이 허용 한도를 초과했습니다.',
  S3_PRESIGN_FAILED: '업로드 URL 생성에 실패했습니다.',
  INVALID_CONTENT_LENGTH: '파일 용량은 0보다 커야 합니다.',
} as const;
