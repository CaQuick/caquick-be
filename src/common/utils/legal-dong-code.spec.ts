import { districtSlugOf, sigunguCodeOf } from '@/common/utils/legal-dong-code';

describe('sigunguCodeOf', () => {
  it.each([
    ['법정동', '4113510900', '41135'],
    ['행정동', '1168064000', '11680'],
    ['시군구 단위', '2812500000', '28125'],
    ['시·도 단위', '1100000000', null],
    ['9자리', '411351090', null],
    ['11자리', '41135109000', null],
    ['숫자 아닌 문자', '41135109A0', null],
    ['빈 문자열', '', null],
    ['숫자 타입', 4113510900, null],
    ['null', null, null],
    ['undefined', undefined, null],
  ])('%s(%p) → %p', (_label, code, expected) => {
    expect(sigunguCodeOf(code)).toBe(expected);
  });
});

describe('districtSlugOf', () => {
  it('시드 2차 지역 slug 형식으로 만든다', () => {
    expect(districtSlugOf('28125')).toBe('sgg-28125');
  });
});
