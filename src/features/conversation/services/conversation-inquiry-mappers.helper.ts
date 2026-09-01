import {
  DEFAULT_GREETING_TEMPLATE,
  GREETING_NICKNAME_PLACEHOLDER,
  GREETING_STORE_NAME_PLACEHOLDER,
} from '@/features/conversation/constants/conversation.constants';
import type {
  ConversationMessageOutput,
  InquiryBusinessHourOutput,
} from '@/features/conversation/types/conversation-output.type';

/** DI-free 순수 함수만 둔다 — 인사말 치환·시각 포맷·메시지 매핑. */

/**
 * 인사말 렌더링. 매장 커스텀 템플릿이 없으면 기본 문구를 쓴다.
 * placeholder는 등장 위치·횟수 제한 없이 전부 치환한다.
 */
export function renderGreeting(
  template: string | null,
  args: { nickname: string; storeName: string },
): string {
  return (template ?? DEFAULT_GREETING_TEMPLATE)
    .replaceAll(GREETING_NICKNAME_PLACEHOLDER, args.nickname)
    .replaceAll(GREETING_STORE_NAME_PLACEHOLDER, args.storeName);
}

/**
 * Prisma Time(@db.Time) → "HH:mm". Time 컬럼은 UTC 기준 Date로 돌아오므로
 * UTC 게터를 써야 저장값 그대로 나온다(business-hours-formatter와 동일 규칙).
 */
export function formatTimeOfDay(date: Date | null): string | null {
  if (!date) return null;
  const h = date.getUTCHours().toString().padStart(2, '0');
  const m = date.getUTCMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function toInquiryBusinessHour(row: {
  day_of_week: number;
  is_closed: boolean;
  open_time: Date | null;
  close_time: Date | null;
}): InquiryBusinessHourOutput {
  return {
    dayOfWeek: row.day_of_week,
    isClosed: row.is_closed,
    openTime: row.is_closed ? null : formatTimeOfDay(row.open_time),
    closeTime: row.is_closed ? null : formatTimeOfDay(row.close_time),
  };
}

export function toConversationMessageOutput(row: {
  id: bigint;
  conversation_id: bigint;
  sender_type: 'USER' | 'STORE' | 'SYSTEM';
  body_format: 'TEXT' | 'HTML';
  body_text: string | null;
  body_html: string | null;
  created_at: Date;
}): ConversationMessageOutput {
  return {
    id: row.id.toString(),
    conversationId: row.conversation_id.toString(),
    senderType: row.sender_type,
    bodyFormat: row.body_format,
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    createdAt: row.created_at,
  };
}
