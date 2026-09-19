import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import {
  MAX_REVIEW_REPORT_DETAIL_LENGTH,
  REVIEW_REPORT_REASONS,
  type ReviewReportReasonValue,
} from '@/features/review/constants/review.constants';

export class ReportReviewInput {
  @IsString()
  reviewId!: string;

  @IsIn(REVIEW_REPORT_REASONS)
  reason!: ReviewReportReasonValue;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_REVIEW_REPORT_DETAIL_LENGTH)
  detail?: string | null;
}
