import type { ConfigService } from '@nestjs/config';

import {
  ACCESS_TOKEN_SECRET_CONFIG_KEY,
  ACCESS_TOKEN_SECRET_MISSING_MESSAGE,
  resolveAccessTokenSecret,
} from '@/global/auth/access-token-secret';

/**
 * 시크릿 소비 규칙의 회귀 가드. 해석 규칙은 config/auth.config.spec.ts에서 고정한다.
 *
 * 핵심은 조회 키가 raw 환경변수가 아니라 authConfig 해석값(`auth.jwtSecret`)이라는 점.
 * raw `JWT_ACCESS_SECRET`을 읽던 시절 JWT_SECRET만 설정한 배포가 여기서 죽었다.
 */
describe('resolveAccessTokenSecret', () => {
  function fakeConfig(values: Record<string, string | undefined>) {
    return {
      get: (key: string) => values[key],
    } as unknown as ConfigService;
  }

  it('authConfig 해석값(auth.jwtSecret)을 읽는다', () => {
    const config = fakeConfig({ [ACCESS_TOKEN_SECRET_CONFIG_KEY]: 'resolved' });

    expect(resolveAccessTokenSecret(config)).toBe('resolved');
  });

  it('raw JWT_ACCESS_SECRET이 아니라 해석값만 본다', () => {
    // 해석값이 비어 있는데 raw 변수만 있는 상황 = authConfig 미로드.
    // 조용히 raw로 우회하지 않고 거절해야 설정 경로가 하나로 유지된다.
    const config = fakeConfig({ JWT_ACCESS_SECRET: 'raw-only' });

    expect(() => resolveAccessTokenSecret(config)).toThrow(
      ACCESS_TOKEN_SECRET_MISSING_MESSAGE,
    );
  });

  it('앞뒤 공백은 잘라낸다', () => {
    const config = fakeConfig({
      [ACCESS_TOKEN_SECRET_CONFIG_KEY]: '  padded  ',
    });

    expect(resolveAccessTokenSecret(config)).toBe('padded');
  });

  it.each([
    { label: '미설정', value: undefined },
    { label: '빈 문자열', value: '' },
    { label: '공백뿐', value: '   ' },
    { label: '탭·개행뿐', value: '\t\n' },
  ])('$label 이면 거절한다', ({ value }) => {
    const config = fakeConfig({ [ACCESS_TOKEN_SECRET_CONFIG_KEY]: value });

    expect(() => resolveAccessTokenSecret(config)).toThrow(
      ACCESS_TOKEN_SECRET_MISSING_MESSAGE,
    );
  });
});
