import authConfig from '@/config/auth.config';

/**
 * 시크릿 해석 규칙의 회귀 가드.
 *
 * 과거 auth.config는 `JWT_ACCESS_SECRET ?? JWT_SECRET`을 받아들였지만 실제 소비처
 * (JwtModule·JwtBearerStrategy)는 raw `JWT_ACCESS_SECRET`만 읽어서, JWT_SECRET만
 * 설정한 배포가 config 검증은 통과하고 모듈 생성에서 죽었다. 여기서 해석 규칙을,
 * access-token-secret.spec.ts에서 소비 규칙을 고정한다.
 */
describe('authConfig', () => {
  const KEYS = [
    'JWT_ACCESS_SECRET',
    'JWT_SECRET',
    'NODE_ENV',
    'JWT_ACCESS_EXPIRES_SECONDS',
    'AUTH_REFRESH_EXPIRES_DAYS',
    'AUTH_COOKIE_DOMAIN',
    'AUTH_COOKIE_SECURE',
    'FRONTEND_BASE_URL',
    'BACKEND_BASE_URL',
  ] as const;

  let saved: Partial<Record<(typeof KEYS)[number], string | undefined>>;

  beforeEach(() => {
    saved = {};
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      const value = saved[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  describe('jwtSecret 해석', () => {
    // 두 변수 × 설정 여부 전수. "둘 다 없으면 거절, 하나라도 있으면 그 값" 계약.
    it.each([
      {
        label: 'JWT_ACCESS_SECRET만',
        access: 'access-only',
        legacy: undefined,
        expected: 'access-only',
      },
      {
        label: 'JWT_SECRET만',
        access: undefined,
        legacy: 'legacy-only',
        expected: 'legacy-only',
      },
      {
        label: '둘 다 (JWT_ACCESS_SECRET 우선)',
        access: 'access-wins',
        legacy: 'legacy-loses',
        expected: 'access-wins',
      },
      {
        label: '앞뒤 공백은 잘라낸다',
        access: '  padded  ',
        legacy: undefined,
        expected: 'padded',
      },
    ])('$label', ({ access, legacy, expected }) => {
      if (access !== undefined) process.env.JWT_ACCESS_SECRET = access;
      if (legacy !== undefined) process.env.JWT_SECRET = legacy;

      expect(authConfig().jwtSecret).toBe(expected);
    });
  });

  describe('fail-fast', () => {
    // 과거에는 prod에서만 던지고 그 외엔 'dev_jwt_secret'으로 흘려보냈다.
    // NODE_ENV 오설정 시 알려진 시크릿으로 뜨는 걸 막기 위해 환경 불문으로 바꿨다.
    it.each(['production', 'development', 'test', undefined])(
      'NODE_ENV=%s 이고 둘 다 미설정이면 거절한다',
      (nodeEnv) => {
        if (nodeEnv !== undefined) process.env.NODE_ENV = nodeEnv;

        expect(() => authConfig()).toThrow(
          'JWT_SECRET or JWT_ACCESS_SECRET must be set',
        );
      },
    );

    it.each([
      { label: '둘 다 빈 문자열', access: '', legacy: '' },
      { label: '둘 다 공백뿐', access: '   ', legacy: '\t' },
      { label: 'JWT_ACCESS_SECRET만 빈 문자열', access: '', legacy: undefined },
    ])('$label 이면 거절한다', ({ access, legacy }) => {
      process.env.JWT_ACCESS_SECRET = access;
      if (legacy !== undefined) process.env.JWT_SECRET = legacy;

      expect(() => authConfig()).toThrow(
        'JWT_SECRET or JWT_ACCESS_SECRET must be set',
      );
    });

    // compose/CI가 미정의 변수를 ''로 주입하는 경우. ??로 받으면 폴백이 건너뛰어져
    // "JWT_SECRET만 설정한 배포"가 다시 깨진다 — 이 PR이 고치려는 바로 그 상황.
    it.each([
      { label: '빈 문자열', access: '' },
      { label: '공백뿐', access: '  ' },
    ])(
      'JWT_ACCESS_SECRET이 $label 이어도 JWT_SECRET으로 폴백한다',
      ({ access }) => {
        process.env.JWT_ACCESS_SECRET = access;
        process.env.JWT_SECRET = 'fallback';

        expect(authConfig().jwtSecret).toBe('fallback');
      },
    );
  });

  describe('cookieSecure 기본값', () => {
    it.each([
      { nodeEnv: 'production', expected: true },
      { nodeEnv: 'development', expected: false },
    ])('NODE_ENV=$nodeEnv 이면 $expected', ({ nodeEnv, expected }) => {
      process.env.NODE_ENV = nodeEnv;
      process.env.JWT_ACCESS_SECRET = 'secret';

      expect(authConfig().cookieSecure).toBe(expected);
    });
  });
});
