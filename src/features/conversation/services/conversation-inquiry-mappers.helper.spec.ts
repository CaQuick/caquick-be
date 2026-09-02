import {
  formatTimeOfDay,
  renderGreeting,
  toInquiryBusinessHour,
} from '@/features/conversation/services/conversation-inquiry-mappers.helper';

describe('conversation-inquiry-mappers.helper', () => {
  describe('renderGreeting', () => {
    it('템플릿이 없으면 기본 문구에 닉네임·매장명을 치환한다', () => {
      const result = renderGreeting(null, {
        nickname: '김현진',
        storeName: '해즈 케이크',
      });

      expect(result).toContain('김현진 고객님');
      expect(result).toContain('해즈 케이크');
      expect(result).not.toContain('{nickname}');
      expect(result).not.toContain('{storeName}');
    });

    it('커스텀 템플릿의 placeholder를 전부 치환한다(다회 등장 포함)', () => {
      const result = renderGreeting(
        '{nickname}님! {storeName}입니다. {nickname}님 환영해요.',
        { nickname: '현진', storeName: '달콤' },
      );

      expect(result).toBe('현진님! 달콤입니다. 현진님 환영해요.');
    });

    it('placeholder가 없는 템플릿은 그대로 반환한다', () => {
      expect(
        renderGreeting('반갑습니다.', { nickname: 'a', storeName: 'b' }),
      ).toBe('반갑습니다.');
    });
  });

  describe('formatTimeOfDay', () => {
    it('Time 컬럼 Date를 UTC 기준 "HH:mm"으로 만든다', () => {
      expect(formatTimeOfDay(new Date('1970-01-01T09:05:00Z'))).toBe('09:05');
      expect(formatTimeOfDay(null)).toBeNull();
    });
  });

  describe('toInquiryBusinessHour', () => {
    it('영업일은 시각을 채우고, 휴무일은 시각을 null로 만든다', () => {
      expect(
        toInquiryBusinessHour({
          day_of_week: 1,
          is_closed: false,
          open_time: new Date('1970-01-01T10:00:00Z'),
          close_time: new Date('1970-01-01T18:00:00Z'),
        }),
      ).toEqual({
        dayOfWeek: 1,
        isClosed: false,
        openTime: '10:00',
        closeTime: '18:00',
      });

      expect(
        toInquiryBusinessHour({
          day_of_week: 0,
          is_closed: true,
          open_time: new Date('1970-01-01T10:00:00Z'),
          close_time: null,
        }),
      ).toEqual({
        dayOfWeek: 0,
        isClosed: true,
        openTime: null,
        closeTime: null,
      });
    });
  });
});
