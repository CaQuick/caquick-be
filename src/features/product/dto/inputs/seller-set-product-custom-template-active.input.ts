import { IsBoolean, IsString } from 'class-validator';

export class SellerSetProductCustomTemplateActiveInput {
  @IsString()
  templateId!: string;

  @IsBoolean()
  isActive!: boolean;
}
