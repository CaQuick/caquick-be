import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

export class SellerUpdateFaqTopicInput {
  @IsString()
  topicId!: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  answerHtml?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
