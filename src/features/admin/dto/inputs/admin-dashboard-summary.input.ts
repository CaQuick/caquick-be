import { IsDate } from 'class-validator';

/** from ≤ to·기간 상한은 service가 검증한다. */
export class AdminDashboardSummaryInput {
  @IsDate()
  from!: Date;

  @IsDate()
  to!: Date;
}
