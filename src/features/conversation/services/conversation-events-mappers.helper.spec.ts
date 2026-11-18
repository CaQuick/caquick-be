import {
  toConversationMessageEvent,
  toEventPreview,
} from '@/features/conversation/services/conversation-events-mappers.helper';
import type { ConversationMessageOutput } from '@/features/conversation/types/conversation-output.type';

function message(
  overrides: Partial<ConversationMessageOutput> = {},
): ConversationMessageOutput {
  return {
    id: '1',
    conversationId: '2',
    senderType: 'USER',
    bodyFormat: 'TEXT',
    bodyText: '안녕하세요',
    bodyHtml: null,
    imageUrl: null,
    orderCard: null,
    createdAt: new Date('2026-08-01T12:00:00Z'),
    ...overrides,
  };
}

describe('conversation-events-mappers.helper', () => {
  it('메시지 출력의 날짜를 ISO 문자열로 바꿔 이벤트 payload를 만든다', () => {
    expect(toConversationMessageEvent(message())).toEqual({
      id: '1',
      conversationId: '2',
      senderType: 'USER',
      bodyFormat: 'TEXT',
      bodyText: '안녕하세요',
      bodyHtml: null,
      imageUrl: null,
      orderCard: null,
      createdAt: '2026-08-01T12:00:00.000Z',
    });
  });

  it('주문 카드 픽업 일시도 ISO 문자열로 바꾼다', () => {
    const event = toConversationMessageEvent(
      message({
        bodyFormat: 'ORDER_CARD',
        orderCard: {
          orderId: '5',
          orderNumber: 'ORD-1',
          productName: '케이크',
          thumbnailUrl: 'https://cdn.example.com/t.jpg',
          pickupAt: new Date('2026-08-03T03:00:00Z'),
        },
      }),
    );
    expect(event.orderCard).toEqual({
      orderId: '5',
      orderNumber: 'ORD-1',
      productName: '케이크',
      thumbnailUrl: 'https://cdn.example.com/t.jpg',
      pickupAt: '2026-08-03T03:00:00.000Z',
    });
  });

  it('미리보기는 TEXT·IMAGE 원문(대체 문구) / HTML 태그 제거 텍스트를 쓴다', () => {
    expect(toEventPreview(message())).toBe('안녕하세요');
    expect(
      toEventPreview(
        message({ bodyFormat: 'IMAGE', bodyText: '사진을 보냈습니다.' }),
      ),
    ).toBe('사진을 보냈습니다.');
    expect(
      toEventPreview(
        message({
          bodyFormat: 'HTML',
          bodyText: null,
          bodyHtml: '<p>자동 <b>응답</b></p>',
        }),
      ),
    ).toBe('자동 응답');
  });
});
