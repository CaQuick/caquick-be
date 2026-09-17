import authConfig from '@/config/auth.config';

const ENV_KEYS = ['NODE_ENV', 'JWT_ACCESS_SECRET', 'JWT_SECRET'] as const;

describe('authConfig', () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
    {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  function setEnv(vars: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
    for (const [key, value] of Object.entries(vars)) process.env[key] = value;
  }

  describe('jwtSecret 해석', () => {
    it.each([
      ['JWT_ACCESS_SECRET만', { JWT_ACCESS_SECRET: 'access' }, 'access'],
      ['JWT_SECRET만', { JWT_SECRET: 'legacy' }, 'legacy'],
      [
        '둘 다면 JWT_ACCESS_SECRET 우선',
        { JWT_ACCESS_SECRET: 'access', JWT_SECRET: 'legacy' },
        'access',
      ],
      [
        'JWT_ACCESS_SECRET이 공백이면 JWT_SECRET으로 폴백',
        { JWT_ACCESS_SECRET: '   ', JWT_SECRET: 'legacy' },
        'legacy',
      ],
      ['앞뒤 공백은 제거', { JWT_ACCESS_SECRET: '  padded  ' }, 'padded'],
    ])('%s', (_label, env, expected) => {
      setEnv({ NODE_ENV: 'production', ...env });
      expect(authConfig().jwtSecret).toBe(expected);
    });
  });

  describe('미설정·공백', () => {
    const blankCases: Array<
      [string, Partial<Record<'JWT_ACCESS_SECRET' | 'JWT_SECRET', string>>]
    > = [
      ['둘 다 미설정', {}],
      ['둘 다 공백', { JWT_ACCESS_SECRET: ' ', JWT_SECRET: '\t' }],
      ['JWT_SECRET만 공백', { JWT_SECRET: '   ' }],
    ];

    it.each(blankCases)('production에서 %s이면 throw', (_label, env) => {
      setEnv({ NODE_ENV: 'production', ...env });
      expect(() => authConfig()).toThrow(
        'JWT_SECRET or JWT_ACCESS_SECRET must be set in production environment',
      );
    });

    it.each(blankCases)(
      'non-prod에서 %s이면 dev 시크릿으로 폴백',
      (_label, env) => {
        setEnv({ NODE_ENV: 'test', ...env });
        expect(authConfig().jwtSecret).toBe('dev_jwt_secret');
      },
    );
  });
});
