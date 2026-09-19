import { IsIn, IsOptional, IsString } from 'class-validator';

const BODY_FORMATS = ['TEXT', 'HTML'] as const;
type ConversationBodyFormat = (typeof BODY_FORMATS)[number];

/** bodyFormat에 따라 bodyText/bodyHtml 중 하나가 필수라는 invariant는 service에서 검증한다(class-validator로 표현하기 어렵다). */
export class SellerSendConversationMessageInput {
  @IsString()
  conversationId!: string;

  @IsIn(BODY_FORMATS)
  bodyFormat!: ConversationBodyFormat;

  @IsOptional()
  @IsString()
  bodyText?: string;

  @IsOptional()
  @IsString()
  bodyHtml?: string;
}
