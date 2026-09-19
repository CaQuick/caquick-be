import { IsString, MaxLength } from 'class-validator';

import { MAX_REASON_LENGTH } from '@/common/constants/reason.constants';

export class AdminDeleteReviewInput {
  @IsString()
  reviewId!: string;

  @IsString()
  @MaxLength(MAX_REASON_LENGTH)
  reason!: string;
}
