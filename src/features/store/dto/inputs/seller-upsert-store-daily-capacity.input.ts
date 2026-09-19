import { IsDate, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class SellerUpsertStoreDailyCapacityInput {
  @IsOptional()
  @IsString()
  capacityId?: string;

  @IsDate()
  capacityDate!: Date;

  @IsInt()
  @Min(0)
  capacity!: number;
}
