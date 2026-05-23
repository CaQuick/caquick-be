import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export type ReviewMediaTypeInput = 'IMAGE' | 'VIDEO';

export class WriteReviewMediaInput {
  @IsIn(['IMAGE', 'VIDEO'])
  mediaType!: ReviewMediaTypeInput;

  @IsString()
  mediaUrl!: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsInt()
  @Min(0)
  sortOrder!: number;
}
