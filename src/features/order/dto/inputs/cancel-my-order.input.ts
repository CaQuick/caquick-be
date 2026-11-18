import { IsOptional, IsString } from 'class-validator';

export class CancelMyOrderInput {
  @IsString()
  orderId!: string;

  @IsOptional()
  @IsString()
  note?: string | null;
}
