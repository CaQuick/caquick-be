import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** 판매자 대화 목록 입력. 커서가 (updated_at, id) 복합이라 공용 SellerCursorInput(id 단독)과 분리했다. */
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
