import { IsEnum, IsOptional } from 'class-validator';

import { CursorInput } from '@/common/dto/inputs/cursor.input';
import { RefundKind, RefundStatus } from '@/generated/prisma/client';

export class AdminRefundListInput extends CursorInput {
  @IsOptional()
  @IsEnum(RefundStatus)
  status?: RefundStatus | null;

  @IsOptional()
  @IsEnum(RefundKind)
  kind?: RefundKind | null;
}
