import { IsBoolean, IsOptional, IsString } from 'class-validator';

import { CursorInput } from '@/common/dto/inputs/cursor.input';

export class AdminReviewCommentListInput extends CursorInput {
  @IsOptional()
  @IsString()
  reviewId?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsBoolean()
  includeDeleted?: boolean;
}
