export type UploadPurpose =
  | 'PROFILE_IMAGE'
  | 'REVIEW_IMAGE'
  | 'REVIEW_VIDEO'
  | 'PRODUCT_IMAGE'
  | 'STORE_IMAGE'
  | 'BANNER_IMAGE';

export interface CreateUploadUrlInput {
  accountId: bigint;
  purpose: UploadPurpose;
  contentType: string;
  contentLength: number;
}

export interface CreateUploadUrlOutput {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  expiresInSeconds: number;
}

export interface UploadPolicy {
  keyPrefix: string;
  maxSizeBytes: number;
  allowedContentTypes: readonly string[];
}
