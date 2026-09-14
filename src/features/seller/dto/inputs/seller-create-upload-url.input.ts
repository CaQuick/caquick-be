import { IsIn, IsInt, IsString, Min } from 'class-validator';

/** 판매자가 발급받을 수 있는 업로드 용도 (SDL enum SellerUploadPurpose와 1:1) */
export const SELLER_UPLOAD_PURPOSES = ['PRODUCT_IMAGE', 'STORE_IMAGE'] as const;

export type SellerUploadPurposeInput = (typeof SELLER_UPLOAD_PURPOSES)[number];

export class SellerCreateUploadUrlInput {
  // 판매자에게 리뷰·프로필 용도 발급을 허용하면 구매자 영역 key를 만들 수 있으므로
  // 화이트리스트로 좁힌다.
  @IsIn(SELLER_UPLOAD_PURPOSES)
  purpose!: SellerUploadPurposeInput;

  @IsString()
  contentType!: string;

  @IsInt()
  @Min(1)
  contentLength!: number;
}
