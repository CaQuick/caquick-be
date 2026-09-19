import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { MAX_REASON_LENGTH } from '@/common/constants/reason.constants';
import {
  REVIEW_REPORT_ACTIONS,
  type ReviewReportActionValue,
} from '@/features/admin/constants/admin.constants';

export class AdminResolveReviewReportInput {
  @IsString()
  reportId!: string;

  @IsIn(REVIEW_REPORT_ACTIONS)
  action!: ReviewReportActionValue;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_REASON_LENGTH)
  note?: string | null;
}
