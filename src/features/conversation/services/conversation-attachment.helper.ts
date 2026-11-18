import { DomainException } from '@/common/errors/error-catalog';
import { MAX_CONVERSATION_IMAGE_URL_LENGTH } from '@/features/conversation/constants/conversation.constants';
import type { S3Service } from '@/global/storage/s3.service';

/** 보내는 계정이 CONVERSATION_IMAGE로 발급받은 URL만 싣는다(구매자·판매자 공용). */
export function requireOwnedConversationImageUrl(
  s3: S3Service,
  raw: string | null | undefined,
  accountId: bigint,
): string {
  const url = raw?.trim();
  if (!url) throw new DomainException('IMAGE_URL_REQUIRED');
  if (
    url.length > MAX_CONVERSATION_IMAGE_URL_LENGTH ||
    !s3.isOwnedUploadUrl(url, 'CONVERSATION_IMAGE', accountId)
  ) {
    throw new DomainException('INVALID_IMAGE_URL');
  }
  return url;
}

/** 주문 카드 대체 문구. 목록 미리보기·판매자 푸시가 본문 대신 이 값을 쓴다. */
export function orderCardAltText(card: {
  productName: string;
  orderNumber: string;
}): string {
  return `주문 문의: ${card.productName} (${card.orderNumber})`;
}
