import { parseOidcProvider } from '@/features/auth/types/oidc-provider.type';

describe('parseOidcProvider', () => {
  it('"google"을 반환한다', () => {
    expect(parseOidcProvider('google')).toBe('google');
  });

  it('"kakao"를 반환한다', () => {
    expect(parseOidcProvider('kakao')).toBe('kakao');
  });

  it('지원하지 않는 provider이면 BadRequestException을 던진다', () => {
    expect(() => parseOidcProvider('facebook')).toThrowDomain(400);
    expect(() => parseOidcProvider('facebook')).toThrowDomain(
      'UNSUPPORTED_OIDC_PROVIDER',
    );
  });

  it('빈 문자열이면 BadRequestException을 던진다', () => {
    expect(() => parseOidcProvider('')).toThrowDomain(400);
    expect(() => parseOidcProvider('')).toThrowDomain(
      'UNSUPPORTED_OIDC_PROVIDER',
    );
  });

  it('대소문자를 구분한다', () => {
    expect(() => parseOidcProvider('Google')).toThrowDomain(400);
    expect(() => parseOidcProvider('Google')).toThrowDomain(
      'UNSUPPORTED_OIDC_PROVIDER',
    );
  });
});
