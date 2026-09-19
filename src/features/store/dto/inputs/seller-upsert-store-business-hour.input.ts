import {
  IsBoolean,
  IsDate,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class SellerUpsertStoreBusinessHourInput {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @IsBoolean()
  isClosed!: boolean;

  @IsOptional()
  @IsDate()
  openTime?: Date | null;

  @IsOptional()
  @IsDate()
  closeTime?: Date | null;
}
