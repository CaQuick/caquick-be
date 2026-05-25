import { IsIn, IsOptional, IsString } from 'class-validator';

const BODY_FORMATS = ['TEXT', 'HTML'] as const;
type SellerConversationBodyFormat = (typeof BODY_FORMATS)[number];

/**
 * 판매자 채팅 메시지 전송 입력.
 *
 * bodyFormat 에 따라 bodyText / bodyHtml 둘 중 하나는 필수라는 invariant 는
 * service 에서 검증 (class-validator 만으로 깔끔하게 표현 어려움).
 */
export class SellerSendConversationMessageInput {
  @IsString()
  conversationId!: string;

  @IsIn(BODY_FORMATS)
  bodyFormat!: SellerConversationBodyFormat;

  @IsOptional()
  @IsString()
  bodyText?: string;

  @IsOptional()
  @IsString()
  bodyHtml?: string;
}
