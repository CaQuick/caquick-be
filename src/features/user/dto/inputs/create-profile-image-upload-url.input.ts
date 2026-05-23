import { IsInt, IsString, Min } from 'class-validator';

/**
 * 프로필 이미지 업로드용 Presigned URL 발급 입력.
 *
 * contentType / contentLength 의 화이트리스트·상한 검증은 S3Service 의
 * createUploadUrl 이 담당. 여기서는 형식만 보장한다.
 */
export class CreateProfileImageUploadUrlInput {
  @IsString()
  contentType!: string;

  @IsInt()
  @Min(1)
  contentLength!: number;
}
