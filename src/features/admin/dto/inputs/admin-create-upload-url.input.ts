import { IsIn, IsInt, IsString, Min } from 'class-validator';

/** 관리자가 발급받을 수 있는 업로드 용도 (SDL enum AdminUploadPurpose와 1:1) */
export const ADMIN_UPLOAD_PURPOSES = ['BANNER_IMAGE', 'STORE_IMAGE'] as const;

export type AdminUploadPurposeInput = (typeof ADMIN_UPLOAD_PURPOSES)[number];

export class AdminCreateUploadUrlInput {
  // 관리자에게도 리뷰·프로필 용도 발급은 허용하지 않는다 — 구매자 소유 영역이다.
  @IsIn(ADMIN_UPLOAD_PURPOSES)
  purpose!: AdminUploadPurposeInput;

  @IsString()
  contentType!: string;

  @IsInt()
  @Min(1)
  contentLength!: number;
}
