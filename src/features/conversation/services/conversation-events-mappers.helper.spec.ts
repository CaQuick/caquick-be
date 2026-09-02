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
      createdAt: '2026-08-01T12:00:00.000Z',
    });
  });

  it('미리보기는 TEXT 원문 / HTML 태그 제거 텍스트를 쓴다', () => {
    expect(toEventPreview(message())).toBe('안녕하세요');
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
