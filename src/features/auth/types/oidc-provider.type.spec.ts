import { parseOidcProvider } from '@/features/auth/types/oidc-provider.type';

describe('parseOidcProvider', () => {
  it('"google"을 반환한다', () => {
    expect(parseOidcProvider('google')).toBe('google');
  });

  it('"kakao"를 반환한다', () => {
    expect(parseOidcProvider('kakao')).toBe('kakao');
  });

  it('지원하지 않는 provider이면 에러를 던진다', () => {
    expect(() => parseOidcProvider('facebook')).toThrow(
      'Unsupported OIDC provider: facebook',
    );
  });

  it('빈 문자열이면 에러를 던진다', () => {
    expect(() => parseOidcProvider('')).toThrow('Unsupported OIDC provider: ');
  });

  it('대소문자를 구분한다', () => {
    expect(() => parseOidcProvider('Google')).toThrow(
      'Unsupported OIDC provider: Google',
    );
  });
});
