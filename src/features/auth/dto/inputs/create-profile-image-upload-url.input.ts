import { IsInt, IsString, Min } from 'class-validator';

/** contentType/contentLength의 화이트리스트·상한 검증은 S3Service.createUploadUrl이 담당. */
export class CreateProfileImageUploadUrlInput {
  @IsString()
  contentType!: string;

  @IsInt()
  @Min(1)
  contentLength!: number;
}
