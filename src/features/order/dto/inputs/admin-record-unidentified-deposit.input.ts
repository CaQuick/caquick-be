import { IsDate, IsInt, IsOptional, IsString } from 'class-validator';

// 메모가 비면 서비스가 DEPOSIT_NOTE_REQUIRED로 거절한다
export class AdminRecordUnidentifiedDepositInput {
  @IsInt()
  amount!: number;

  @IsString()
  depositorName!: string;

  @IsOptional()
  @IsDate()
  depositedAt?: Date | null;

  @IsString()
  note!: string;
}
