import { IsIn, IsOptional, IsString } from 'class-validator';

import { ConversationBodyFormat } from '@/generated/prisma/client';

/**
 * 형식별 필수 필드·판매자가 보낼 수 없는 형식(ORDER_CARD)은 service가 판정한다. DTO는 SDL enum 전체를 받아야
 * ORDER_CARD가 VALIDATION_FAILED가 아니라 INVALID_BODY_FORMAT으로 거절된다.
 */
export class SellerSendConversationMessageInput {
  @IsString()
  conversationId!: string;

  @IsIn(Object.values(ConversationBodyFormat))
  bodyFormat!: ConversationBodyFormat;

  @IsOptional()
  @IsString()
  bodyText?: string;

  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}
