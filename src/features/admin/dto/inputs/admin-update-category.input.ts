import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

/** non-null 컬럼(name·sortOrder·isActive)은 명시적 null 거절, description은 null이 "제거". */
const ifPresent = (field: keyof AdminUpdateCategoryInput) =>
  ValidateIf((o: AdminUpdateCategoryInput) => o[field] !== undefined);

export class AdminUpdateCategoryInput {
  @IsString()
  categoryId!: string;

  @ifPresent('name')
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @ifPresent('sortOrder')
  @IsInt()
  sortOrder?: number;

  @ifPresent('isActive')
  @IsBoolean()
  isActive?: boolean;
}
