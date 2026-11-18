import { Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { PHONE_REGEX } from '@/features/auth';
import { CreateOrderCustomInput } from '@/features/order/dto/inputs/create-order-custom.input';

export class CreateOrderInput {
  // 8~64자, 공백 문자 불가 — 형식은 길이만 제한한다.
  @IsString()
  @Length(8, 64)
  @Matches(/^\S+$/)
  idempotencyKey!: string;

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
  @Matches(PHONE_REGEX)
  buyerPhone?: string;

  // 길이(20자)는 생략 시 쓰는 주문자 이름과 같은 규칙으로 서비스가 DEPOSITOR_NAME_INVALID로 판정한다
  @IsOptional()
  @IsString()
  depositorName?: string;

  @IsInt()
  @Min(0)
  expectedTotalPrice!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  requestNote?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateOrderCustomInput)
  custom?: CreateOrderCustomInput | null;
}
