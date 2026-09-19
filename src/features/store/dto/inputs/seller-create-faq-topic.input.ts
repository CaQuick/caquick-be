import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

export class SellerCreateFaqTopicInput {
  @IsString()
  title!: string;

  @IsString()
  answerHtml!: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
