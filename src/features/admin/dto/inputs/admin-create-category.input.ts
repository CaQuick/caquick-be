import { IsBoolean, IsIn, IsInt, IsOptional, IsString } from 'class-validator';

import {
  CATEGORY_TYPES,
  type CategoryTypeValue,
} from '@/features/admin/constants/admin.constants';

/** 길이·공백 정리는 service(cleanRequiredText/cleanNullableText)가 담당. */
export class AdminCreateCategoryInput {
  @IsIn(CATEGORY_TYPES)
  categoryType!: CategoryTypeValue;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsInt()
  sortOrder?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean | null;
}
