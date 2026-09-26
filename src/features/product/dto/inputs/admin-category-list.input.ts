import { IsBoolean, IsIn, IsOptional } from 'class-validator';

import {
  CATEGORY_TYPES,
  type CategoryTypeValue,
} from '@/features/product/constants/product-admin.constants';

export class AdminCategoryListInput {
  @IsOptional()
  @IsIn(CATEGORY_TYPES)
  categoryType?: CategoryTypeValue;

  @IsOptional()
  @IsBoolean()
  includeInactive?: boolean;
}
