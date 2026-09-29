import { readKakaoLocalConfig } from '@/config/kakao-local.config';

describe('kakaoLocalConfig', () => {
  it('REST API 키는 OIDC_KAKAO_CLIENT_ID를 읽는다', () => {
    expect(readKakaoLocalConfig({ OIDC_KAKAO_CLIENT_ID: ' abc ' })).toEqual({
      restApiKey: 'abc',
    });
  });

  it.each([undefined, '', '   '])('미설정(%p)이면 키가 없다', (value) => {
    expect(readKakaoLocalConfig({ OIDC_KAKAO_CLIENT_ID: value })).toEqual({
      restApiKey: undefined,
    });
  });
});
