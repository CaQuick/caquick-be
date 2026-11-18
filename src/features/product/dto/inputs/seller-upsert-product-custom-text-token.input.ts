import { IsBoolean, IsIn, IsInt, IsOptional, IsString } from 'class-validator';

import { CustomTextAlign } from '@/generated/prisma/client';

/** 범위·형식(최대 글자 수·좌표·글자색·키)은 도메인 오류 코드를 내도록 service가 검사한다. */
export class SellerUpsertProductCustomTextTokenInput {
  @IsOptional()
  @IsString()
  tokenId?: string;

  @IsString()
  templateId!: string;

  @IsString()
  tokenKey!: string;

  @IsOptional()
  @IsString()
  label?: string | null;

  @IsString()
  defaultText!: string;

  @IsOptional()
  @IsInt()
  maxLength?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsInt()
  posX!: number;

  @IsInt()
  posY!: number;

  @IsInt()
  width!: number;

  @IsInt()
  height!: number;

  @IsOptional()
  @IsString()
  textColor?: string | null;

  @IsOptional()
  @IsIn(Object.values(CustomTextAlign))
  textAlign?: CustomTextAlign | null;
}
