import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';

import { WriteReviewMediaInput } from '@/features/user/dto/inputs/write-review-media.input';
import { IsRatingValid } from '@/features/user/dto/validators/rating.validator';

/** 미디어 개수 상한(이미지 10, 동영상 1) 같은 도메인 invariant는 service에서 검증한다. */
export class WriteReviewInput {
  @IsString()
  orderItemId!: string;

  @IsNumber()
  @IsRatingValid()
  rating!: number;

  // 길이 검증 전에 trim한다 — service가 trim 후 저장하므로 공백으로 부풀린 입력이 raw 길이로 통과해 빈 리뷰로 저장되는 회귀를 막는다.
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(20, 1000)
  content!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WriteReviewMediaInput)
  media?: WriteReviewMediaInput[];
}
