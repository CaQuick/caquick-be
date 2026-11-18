import { IsString } from 'class-validator';

export class AdminLinkUnidentifiedDepositInput {
  @IsString()
  depositRecordId!: string;

  @IsString()
  orderId!: string;
}
