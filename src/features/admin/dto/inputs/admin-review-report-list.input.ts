import { IsIn, IsOptional } from 'class-validator';

import {
  REVIEW_REPORT_STATUSES,
  REVIEW_REPORT_TARGET_TYPES,
  type ReviewReportStatusValue,
  type ReviewReportTargetTypeValue,
} from '@/features/admin/constants/admin.constants';
import { AdminCursorInput } from '@/features/admin/dto/inputs/admin-cursor.input';

export class AdminReviewReportListInput extends AdminCursorInput {
  /** SDL 기본값 PENDING. null을 명시하면 전체. */
  @IsOptional()
  @IsIn(REVIEW_REPORT_STATUSES)
  status?: ReviewReportStatusValue | null;

  @IsOptional()
  @IsIn(REVIEW_REPORT_TARGET_TYPES)
  targetType?: ReviewReportTargetTypeValue;
}
