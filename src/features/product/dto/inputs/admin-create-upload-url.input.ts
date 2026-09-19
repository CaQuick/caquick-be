import { IsIn, IsInt, IsString, Min } from 'class-validator';

export const ADMIN_UPLOAD_PURPOSES = ['BANNER_IMAGE', 'STORE_IMAGE'] as const;
export type AdminUploadPurposeInput = (typeof ADMIN_UPLOAD_PURPOSES)[number];

// contentType·contentLength의 허용 목록·상한은 S3Service.createUploadUrl이 담당한다.
export class AdminCreateUploadUrlInput {
  @IsIn(ADMIN_UPLOAD_PURPOSES)
  purpose!: AdminUploadPurposeInput;

  @IsString()
  contentType!: string;

  @IsInt()
  @Min(1)
  contentLength!: number;
}
