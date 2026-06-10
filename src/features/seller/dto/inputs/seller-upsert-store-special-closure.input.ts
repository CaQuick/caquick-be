import { IsDate, IsOptional, IsString } from 'class-validator';

export class SellerUpsertStoreSpecialClosureInput {
  @IsOptional()
  @IsString()
  closureId?: string;

  @IsDate()
  closureDate!: Date;

  @IsOptional()
  @IsString()
  reason?: string | null;
}
