import { Type } from 'class-transformer';
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

/**
 * 리뷰 작성 입력.
 *
 * 미디어 개수 상한(이미지 10, 동영상 1) 같은 도메인 invariant 는 service 에서
 * 검증. 여기서는 각 항목의 형식과 별점/내용 길이만 본다.
 */
export class WriteReviewInput {
  @IsString()
  orderItemId!: string;

  @IsNumber()
  @IsRatingValid()
  rating!: number;

  @IsString()
  @Length(20, 1000)
  content!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WriteReviewMediaInput)
  media?: WriteReviewMediaInput[];
}
