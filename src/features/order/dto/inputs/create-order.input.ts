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
} from 'class-validator';

import { PHONE_REGEX } from '@/features/user';

export class CreateOrderInput {
  // 정책: 8~64자, 공백 문자 불가(이슈 #212 사용자 확정 — 형식은 길이만 제한).
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
}
