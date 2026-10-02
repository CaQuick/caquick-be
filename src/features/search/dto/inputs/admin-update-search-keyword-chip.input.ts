import {
  IsBoolean,
  IsDate,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

/** non-null 컬럼(keyword·isActive)은 명시적 null 거절, 기간은 null이 "제한 없앰". */
const ifPresent = (field: keyof AdminUpdateSearchKeywordChipInput) =>
  ValidateIf((o: AdminUpdateSearchKeywordChipInput) => o[field] !== undefined);

export class AdminUpdateSearchKeywordChipInput {
  @IsString()
  chipId!: string;

  @ifPresent('keyword')
  @IsString()
  keyword?: string;

  @ifPresent('isActive')
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDate()
  startsAt?: Date | null;

  @IsOptional()
  @IsDate()
  endsAt?: Date | null;
}
