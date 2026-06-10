import { IsBoolean, IsString } from 'class-validator';

export class SellerSetProductActiveInput {
  @IsString()
  productId!: string;

  @IsBoolean()
  isActive!: boolean;
}
