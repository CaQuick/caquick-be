import { Type } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { CustomImageKind } from '@/generated/prisma/client';

// 저장 컬럼 길이. 개수·글자 수·좌표 범위는 상품 설정과 함께 봐야 해서 서비스가 도메인 코드로 판정한다.
const MAX_URL_LENGTH = 2048;

export class CreateOrderSlotTextInput {
  @IsString()
  tokenId!: string;

  @IsOptional()
  @IsString()
  valueText?: string | null;
}

export class CreateOrderFreeEditInput {
  @IsInt()
  posX!: number;

  @IsInt()
  posY!: number;

  @IsInt()
  width!: number;

  @IsInt()
  height!: number;

  @IsString()
  descriptionText!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(MAX_URL_LENGTH, { each: true })
  referenceImageUrls?: string[] | null;
}

export class CreateOrderSlotCustomInput {
  @IsInt()
  templateRevision!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderSlotTextInput)
  texts!: CreateOrderSlotTextInput[];

  @IsString()
  @MaxLength(MAX_URL_LENGTH)
  compositeImageUrl!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderFreeEditInput)
  freeEdits?: CreateOrderFreeEditInput[] | null;
}

export class ThreeDDesignBasicInput {
  @IsString()
  shape!: string;

  @IsString()
  size!: string;

  @IsOptional()
  @IsString()
  design?: string | null;

  @IsOptional()
  @IsString()
  flavor?: string | null;

  @IsString()
  sheetColor!: string;
}

export class ThreeDDesignEffectInput {
  @IsString()
  type!: string;

  @IsInt()
  intensity!: number;
}

export class ThreeDDesignItemInput {
  @IsIn(['TEXT', 'DECO'])
  kind!: 'TEXT' | 'DECO';

  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;

  @IsNumber()
  size!: number;

  @IsDefined()
  @ValidateNested()
  @Type(() => ThreeDDesignEffectInput)
  effect!: ThreeDDesignEffectInput;

  @IsOptional()
  @IsString()
  text?: string | null;

  @IsOptional()
  @IsString()
  color?: string | null;

  @IsOptional()
  @IsString()
  decoId?: string | null;
}

export class ThreeDDesignInput {
  @IsInt()
  schemaVersion!: number;

  @IsDefined()
  @ValidateNested()
  @Type(() => ThreeDDesignBasicInput)
  basic!: ThreeDDesignBasicInput;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ThreeDDesignItemInput)
  top!: ThreeDDesignItemInput[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ThreeDDesignItemInput)
  side!: ThreeDDesignItemInput[];
}

export class CreateOrderRenderImageInput {
  @IsEnum(CustomImageKind)
  kind!: CustomImageKind;

  @IsString()
  @MaxLength(MAX_URL_LENGTH)
  imageUrl!: string;
}

export class CreateOrderThreeDCustomInput {
  @IsDefined()
  @ValidateNested()
  @Type(() => ThreeDDesignInput)
  design!: ThreeDDesignInput;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderRenderImageInput)
  renderImages!: CreateOrderRenderImageInput[];
}

/** 커스텀 상품이면 그 방식의 입력 하나만 보낸다. */
export class CreateOrderCustomInput {
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateOrderSlotCustomInput)
  slot?: CreateOrderSlotCustomInput | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateOrderThreeDCustomInput)
  threeD?: CreateOrderThreeDCustomInput | null;
}
