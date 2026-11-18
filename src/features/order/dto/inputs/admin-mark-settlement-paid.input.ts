import { IsOptional, IsString } from 'class-validator';

export class AdminMarkSettlementPaidInput {
  @IsString()
  settlementId!: string;

  @IsOptional()
  @IsString()
  note?: string;
}
