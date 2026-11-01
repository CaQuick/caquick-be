import { resolveReturnTo } from '@/features/auth/helpers/return-to.helper';

const FALLBACK = 'https://caquick.site';
const ALLOWED = ['https://caquick.site', 'http://localhost:3000'];

describe('resolveReturnTo', () => {
  it.each([
    ['https://caquick.site/mypage', 'https://caquick.site/mypage'],
    ['http://localhost:3000/a?b=1', 'http://localhost:3000/a?b=1'],
    ['  https://caquick.site/x  ', 'https://caquick.site/x'],
  ])('허용 오리진이면 그 주소로 보낸다: %s', (raw, expected) => {
    expect(resolveReturnTo(raw, FALLBACK, ALLOWED)).toBe(expected);
  });

  it.each([
    ['접두가 같은 다른 호스트', 'https://caquick.site.evil.com/x'],
    ['userinfo로 위장한 호스트', 'https://caquick.site@evil.com/x'],
    ['이어 붙인 호스트', 'https://caquick.siteevil.com'],
    ['스킴 불일치', 'http://caquick.site/x'],
    ['포트 불일치', 'http://localhost:3001/x'],
    ['스킴 상대 주소', '//evil.com'],
    ['상대 경로', '/mypage'],
    ['javascript 스킴', 'javascript:alert(1)'],
    ['빈 문자열', ''],
    ['공백', '   '],
    ['undefined', undefined],
  ])('%s(%s)는 기본 주소로 보낸다', (_label, raw) => {
    expect(resolveReturnTo(raw, FALLBACK, ALLOWED)).toBe(FALLBACK);
  });

  it('기본 주소의 오리진은 허용 목록에 없어도 허용한다', () => {
    expect(
      resolveReturnTo(
        'https://front.example/a',
        'https://front.example',
        ALLOWED,
      ),
    ).toBe('https://front.example/a');
  });
});
