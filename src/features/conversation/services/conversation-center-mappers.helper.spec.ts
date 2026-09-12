import {
  stripHtmlToPreview,
  toLastMessagePreview,
} from '@/features/conversation/services/conversation-center-mappers.helper';

describe('conversation-center-mappers.helper', () => {
  describe('stripHtmlToPreview', () => {
    it('태그를 제거하고 공백을 정리한다', () => {
      expect(
        stripHtmlToPreview(
          '<p>🎂 <strong>케이크 보관 방법</strong></p><ul><li>냉장 3일</li></ul>',
        ),
      ).toBe('🎂 케이크 보관 방법 냉장 3일');
    });

    it('기본 HTML 엔티티를 복원한다', () => {
      expect(stripHtmlToPreview('A&nbsp;&amp;&nbsp;B &lt;3&gt;')).toBe(
        'A & B <3>',
      );
    });

    it('이중 이스케이프는 한 번만 복원한다(&amp;lt; → &lt;)', () => {
      expect(stripHtmlToPreview('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
    });
  });

  describe('toLastMessagePreview', () => {
    it('TEXT 메시지는 원문, HTML 메시지는 태그 제거 텍스트를 반환한다', () => {
      expect(
        toLastMessagePreview({
          body_format: 'TEXT',
          body_text: '안녕하세요',
          body_html: null,
        }),
      ).toBe('안녕하세요');
      expect(
        toLastMessagePreview({
          body_format: 'HTML',
          body_text: null,
          body_html: '<p>답변</p>',
        }),
      ).toBe('답변');
    });

    it('메시지가 없거나 본문이 비면 null', () => {
      expect(toLastMessagePreview(null)).toBeNull();
      expect(
        toLastMessagePreview({
          body_format: 'HTML',
          body_text: null,
          body_html: null,
        }),
      ).toBeNull();
    });
  });
});
