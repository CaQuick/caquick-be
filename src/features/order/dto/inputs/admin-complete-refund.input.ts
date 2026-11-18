import { IsOptional, IsString } from 'class-validator';

export class AdminCompleteRefundInput {
  @IsString()
  refundId!: string;

  @IsOptional()
  @IsString()
  note?: string | null;
}
