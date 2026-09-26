import { IsString, Matches } from 'class-validator';

export class DevIssueTokenInput {
  @IsString()
  @Matches(/^\d+$/, { message: 'accountId must be a numeric string.' })
  accountId!: string;
}
