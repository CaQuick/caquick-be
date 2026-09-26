import { IsIn, IsOptional } from 'class-validator';

import { CursorInput } from '@/common/dto/inputs/cursor.input';
import {
  REVIEW_REPORT_STATUSES,
  REVIEW_REPORT_TARGET_TYPES,
  type ReviewReportStatusValue,
  type ReviewReportTargetTypeValue,
} from '@/features/review/constants/review.constants';

export class AdminReviewReportListInput extends CursorInput {
  /** SDL 기본값 PENDING. null을 명시하면 전체. */
  @IsOptional()
  @IsIn(REVIEW_REPORT_STATUSES)
  status?: ReviewReportStatusValue | null;

  @IsOptional()
  @IsIn(REVIEW_REPORT_TARGET_TYPES)
  targetType?: ReviewReportTargetTypeValue;
}
