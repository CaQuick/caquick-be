import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

/**
 * 리뷰 댓글 작성 입력.
 *
 * 길이 검증 전에 trim 한다. service 가 trim 후 저장하므로, 공백만으로
 * 부풀린 입력이 raw 길이로 통과해 빈 댓글로 저장되는 것을 막는다.
 */
export class WriteReviewCommentInput {
  @IsString()
  reviewId!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(1, 500)
  content!: string;
}
