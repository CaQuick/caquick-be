import { IsBoolean, IsIn, IsOptional } from 'class-validator';

import { CursorInput } from '@/common/dto/inputs/cursor.input';
import {
  BANNER_PLACEMENTS,
  type BannerPlacementValue,
} from '@/features/admin/constants/admin.constants';

export class AdminBannerListInput extends CursorInput {
  @IsOptional()
  @IsIn(BANNER_PLACEMENTS)
  placement?: BannerPlacementValue;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
