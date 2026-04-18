import {
  buildQueryString,
  toQueryParams,
} from '@/common/helpers/url-query.helper';

describe('url-query.helper', () => {
  describe('buildQueryString', () => {
    it('단순 키=값 쌍을 변환한다', () => {
      expect(buildQueryString({ a: '1', b: '2' })).toBe('a=1&b=2');
    });

    it('null/undefined 값은 제외한다', () => {
      expect(buildQueryString({ a: '1', b: null, c: undefined })).toBe('a=1');
    });

    it('배열 값을 쉼표로 구분한다', () => {
      expect(buildQueryString({ ids: [1, 2, 3] })).toBe('ids=1,2,3');
    });

    it('특수문자를 인코딩한다', () => {
      expect(buildQueryString({ q: 'hello world' })).toBe('q=hello%20world');
    });

    it('숫자/불리언을 문자열로 변환한다', () => {
      expect(buildQueryString({ n: 42, b: true })).toBe('n=42&b=true');
    });

    it('빈 객체이면 빈 문자열을 반환한다', () => {
      expect(buildQueryString({})).toBe('');
    });
  });

  describe('toQueryParams', () => {
    it('undefined이면 빈 객체를 반환한다', () => {
      expect(toQueryParams(undefined)).toEqual({});
    });

    it('문자열 값을 그대로 유지한다', () => {
      expect(toQueryParams({ key: 'value' })).toEqual({ key: 'value' });
    });

    it('배열 값의 각 원소를 문자열로 변환한다', () => {
      expect(toQueryParams({ ids: ['1', '2'] })).toEqual({
        ids: ['1', '2'],
      });
    });

    it('null/undefined 값은 제외한다', () => {
      expect(toQueryParams({ a: '1', b: undefined })).toEqual({ a: '1' });
    });

    it('중첩 객체를 JSON 문자열로 변환한다', () => {
      const result = toQueryParams({ nested: { x: 1 } as never });
      expect(result.nested).toBe('{"x":1}');
    });
  });
});
