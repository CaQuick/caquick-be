import { IsIn, IsInt, IsString, Min } from 'class-validator';

import type { ReviewMediaTypeInput } from '@/features/mypage/dto/inputs/write-review-media.input';

export class CreateReviewMediaUploadUrlInput {
  @IsIn(['IMAGE', 'VIDEO'])
  mediaType!: ReviewMediaTypeInput;

  @IsString()
  contentType!: string;

  @IsInt()
  @Min(1)
  contentLength!: number;
}
