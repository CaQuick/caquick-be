import {
  CONVERSATION_BUYER_MESSAGE_SENT,
  conversationBuyerMessageSentEvent,
  parseConversationBuyerMessageSentPayload,
  toBuyerMessagePreview,
} from '@/features/conversation/events/conversation-buyer-message-sent.event';
import type { Prisma } from '@/generated/prisma/client';

const CREATED_AT = new Date('2026-09-16T07:00:00.000Z');

const VALID = {
  conversationId: '11',
  storeId: '5',
  buyerAccountId: '3',
  messageId: '42',
  preview: '픽업 시간 변경 가능한가요?',
  messageCreatedAt: CREATED_AT.toISOString(),
};

describe('conversation.buyer_message_sent 이벤트', () => {
  it('bigint·Date를 문자열로 싣고 conversation aggregate에 묶는다', () => {
    const event = conversationBuyerMessageSentEvent({
      conversationId: 11n,
      storeId: 5n,
      buyerAccountId: 3n,
      message: {
        id: 42n,
        body_format: 'TEXT',
        body_text: VALID.preview,
        body_html: null,
        created_at: CREATED_AT,
      },
    });

    expect(event).toEqual({
      aggregateType: 'conversation',
      aggregateId: '11',
      eventType: CONVERSATION_BUYER_MESSAGE_SENT,
      payload: VALID,
      occurredAt: CREATED_AT,
      actorAccountId: 3n,
    });
    expect(
      parseConversationBuyerMessageSentPayload(
        event.payload as Prisma.JsonValue,
      ),
    ).toEqual(VALID);
  });

  it.each([
    ['TEXT 본문 그대로', 'TEXT', '안녕하세요', null, '안녕하세요'],
    [
      'HTML은 태그를 걷어낸다',
      'HTML',
      null,
      '<p>냉장보관시 <b>최대</b> 3일</p>',
      '냉장보관시 최대 3일',
    ],
    [
      'TEXT 본문 101자는 100자로 자른다',
      'TEXT',
      'a'.repeat(101),
      null,
      'a'.repeat(100),
    ],
    [
      'HTML은 태그 제거 뒤 자른다',
      'HTML',
      null,
      `<p>${'b'.repeat(150)}</p>`,
      'b'.repeat(100),
    ],
    ['본문 없으면 빈 문자열', 'HTML', null, null, ''],
  ] as const)('preview: %s', (_label, format, text, html, expected) => {
    expect(
      toBuyerMessagePreview({
        body_format: format,
        body_text: text,
        body_html: html,
      }),
    ).toBe(expected);
  });

  it.each([
    ['null', null],
    ['배열', [VALID]],
    ['문자열', 'x'],
    ['conversationId 누락', { ...VALID, conversationId: undefined }],
    ['conversationId 숫자', { ...VALID, conversationId: 11 }],
    ['storeId null', { ...VALID, storeId: null }],
    ['buyerAccountId 숫자', { ...VALID, buyerAccountId: 3 }],
    ['messageId 누락', { ...VALID, messageId: undefined }],
    ['preview null', { ...VALID, preview: null }],
    ['messageCreatedAt 숫자', { ...VALID, messageCreatedAt: 1_700_000_000 }],
    ['messageCreatedAt 비ISO', { ...VALID, messageCreatedAt: 'yesterday' }],
  ])('반증: %s payload는 던진다', (_label, payload) => {
    expect(() =>
      parseConversationBuyerMessageSentPayload(
        payload as Parameters<
          typeof parseConversationBuyerMessageSentPayload
        >[0],
      ),
    ).toThrow('payload 형식 오류');
  });
});
