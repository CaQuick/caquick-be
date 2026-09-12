import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * 판매자 대화 목록 입력.
 *
 * 커서가 (updated_at, id) 복합이라 공용 SellerCursorInput(id 단독)과 분리했다 —
 * 정렬 키를 그대로 커서에 담지 않으면 목록에서 빠지는 대화가 생긴다.
 */
export class SellerConversationListInput {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}
