import {
  IsArray,
  IsDate,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { ORDER_BUYER_PHONE_REGEX } from '@/features/order/constants/order.constants';

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
  // 프로필 전화번호와 동일 정책(010-XXXX-XXXX 고정) — 임의 문자열이
  // 검증된 프로필 값을 덮어쓰지 못하게 형식을 강제한다
  @Matches(ORDER_BUYER_PHONE_REGEX)
  buyerPhone?: string;
}
