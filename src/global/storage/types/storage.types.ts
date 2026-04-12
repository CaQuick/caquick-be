/**
 * 업로드 목적 (purpose별 정책이 달라짐)
 */
export type UploadPurpose = 'PROFILE_IMAGE' | 'REVIEW_IMAGE' | 'REVIEW_VIDEO';

/**
 * Presigned URL 발급 요청 입력
 */
export interface CreateUploadUrlInput {
  accountId: bigint;
  purpose: UploadPurpose;
  contentType: string;
  contentLength: number;
}

/**
 * Presigned URL 발급 결과
 */
export interface CreateUploadUrlOutput {
  /** Presigned PUT URL (클라이언트가 이 URL로 직접 업로드) */
  uploadUrl: string;
  /** 업로드 완료 후 접근 가능한 공개 URL */
  publicUrl: string;
  /** S3 object key */
  key: string;
  /** URL 만료 시간(초) */
  expiresInSeconds: number;
}

/**
 * 업로드 정책 정의
 */
export interface UploadPolicy {
  keyPrefix: string;
  maxSizeBytes: number;
  allowedContentTypes: readonly string[];
}
