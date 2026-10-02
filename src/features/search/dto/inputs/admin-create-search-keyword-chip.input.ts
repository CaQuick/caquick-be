import { IsBoolean, IsDate, IsOptional, IsString } from 'class-validator';

export class AdminCreateSearchKeywordChipInput {
  @IsString()
  keyword!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean | null;

  @IsOptional()
  @IsDate()
  startsAt?: Date | null;

  @IsOptional()
  @IsDate()
  endsAt?: Date | null;
}
