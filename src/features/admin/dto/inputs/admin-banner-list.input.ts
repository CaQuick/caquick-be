import { IsBoolean, IsIn, IsOptional } from 'class-validator';

import {
  BANNER_PLACEMENTS,
  type BannerPlacementValue,
} from '@/features/admin/constants/admin.constants';
import { AdminCursorInput } from '@/features/admin/dto/inputs/admin-cursor.input';

export class AdminBannerListInput extends AdminCursorInput {
  @IsOptional()
  @IsIn(BANNER_PLACEMENTS)
  placement?: BannerPlacementValue;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
