import {
  IsArray,
  IsDate,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateOrderInput {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsArray()
  @IsString({ each: true })
  optionItemIds!: string[];

  @IsDate()
  pickupAt!: Date;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  quantity?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  buyerName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  buyerPhone?: string;
}
