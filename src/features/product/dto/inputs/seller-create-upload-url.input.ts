import { IsIn, IsInt, IsString, Min } from 'class-validator';

export const SELLER_UPLOAD_PURPOSES = ['PRODUCT_IMAGE', 'STORE_IMAGE'] as const;
export type SellerUploadPurposeInput = (typeof SELLER_UPLOAD_PURPOSES)[number];

// contentType·contentLength의 허용 목록·상한은 S3Service.createUploadUrl이 담당한다.
export class SellerCreateUploadUrlInput {
  @IsIn(SELLER_UPLOAD_PURPOSES)
  purpose!: SellerUploadPurposeInput;

  @IsString()
  contentType!: string;

  @IsInt()
  @Min(1)
  contentLength!: number;
}
