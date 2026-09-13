import { IsString } from 'class-validator';

export class AdminUpdateTagInput {
  @IsString()
  tagId!: string;

  @IsString()
  name!: string;
}
