import {
  normalizeSearchKeyword,
  SEARCH_KEYWORD_MAX_LENGTH,
  splitSearchWords,
} from '@/common/utils/search-keyword';

describe('search-keyword utils', () => {
  describe('normalizeSearchKeyword', () => {
    it('앞뒤 공백을 제거하고 연속 공백을 하나로 축약한다', () => {
      expect(normalizeSearchKeyword('  딸기   케이크\t\n')).toEqual({
        ok: true,
        keyword: '딸기 케이크',
      });
    });

    it('1글자 검색어를 허용한다', () => {
      expect(normalizeSearchKeyword('a')).toEqual({ ok: true, keyword: 'a' });
    });

    it('공백만 있으면 EMPTY로 거절한다', () => {
      expect(normalizeSearchKeyword('   ')).toEqual({
        ok: false,
        reason: 'EMPTY',
      });
    });

    it('정규화 후 200자를 넘으면 TOO_LONG으로 거절한다', () => {
      const raw = 'a'.repeat(SEARCH_KEYWORD_MAX_LENGTH + 1);
      expect(normalizeSearchKeyword(raw)).toEqual({
        ok: false,
        reason: 'TOO_LONG',
      });
      expect(
        normalizeSearchKeyword(`  ${'a'.repeat(SEARCH_KEYWORD_MAX_LENGTH)}  `)
          .ok,
      ).toBe(true);
    });
  });

  describe('splitSearchWords', () => {
    it('공백 기준으로 나누고 중복 단어를 제거한다', () => {
      expect(splitSearchWords('딸기 케이크 딸기')).toEqual(['딸기', '케이크']);
    });

    it('단어 하나면 그대로 반환한다', () => {
      expect(splitSearchWords('레터링')).toEqual(['레터링']);
    });
  });
});
