import { IsBoolean, IsOptional, IsString } from 'class-validator';

import { AdminCursorInput } from '@/features/admin/dto/inputs/admin-cursor.input';

export class AdminReviewCommentListInput extends AdminCursorInput {
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
