import type { ConfigService } from '@nestjs/config';

import {
  getEnvAsBoolean,
  getEnvAsNumber,
  mustGetEnv,
} from '@/common/helpers/config.helper';

function mockConfig(map: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => map[key] } as unknown as ConfigService;
}

describe('config.helper', () => {
  describe('mustGetEnv', () => {
    it('값이 있으면 trim하여 반환한다', () => {
      const config = mockConfig({ KEY: '  hello  ' });
      expect(mustGetEnv(config, 'KEY')).toBe('hello');
    });

    it('값이 없으면 에러를 던진다', () => {
      const config = mockConfig({ KEY: undefined });
      expect(() => mustGetEnv(config, 'KEY')).toThrow(
        'Missing required environment variable: KEY',
      );
    });

    it('빈 문자열이면 에러를 던진다', () => {
      const config = mockConfig({ KEY: '   ' });
      expect(() => mustGetEnv(config, 'KEY')).toThrow(
        'Missing required environment variable: KEY',
      );
    });
  });

  describe('getEnvAsNumber', () => {
    it('유효한 숫자 문자열이면 파싱하여 반환한다', () => {
      const config = mockConfig({ PORT: '3000' });
      expect(getEnvAsNumber(config, 'PORT', 8080)).toBe(3000);
    });

    it('값이 없으면 기본값을 반환한다', () => {
      const config = mockConfig({});
      expect(getEnvAsNumber(config, 'PORT', 8080)).toBe(8080);
    });

    it('NaN이면 기본값을 반환한다', () => {
      const config = mockConfig({ PORT: 'abc' });
      expect(getEnvAsNumber(config, 'PORT', 8080)).toBe(8080);
    });

    it('0 이하이면 기본값을 반환한다', () => {
      const config = mockConfig({ PORT: '0' });
      expect(getEnvAsNumber(config, 'PORT', 8080)).toBe(8080);
    });

    it('음수이면 기본값을 반환한다', () => {
      const config = mockConfig({ PORT: '-1' });
      expect(getEnvAsNumber(config, 'PORT', 8080)).toBe(8080);
    });
  });

  describe('getEnvAsBoolean', () => {
    it('"true"이면 true를 반환한다', () => {
      const config = mockConfig({ FLAG: 'true' });
      expect(getEnvAsBoolean(config, 'FLAG', false)).toBe(true);
    });

    it('"TRUE" (대문자)이면 true를 반환한다', () => {
      const config = mockConfig({ FLAG: ' TRUE ' });
      expect(getEnvAsBoolean(config, 'FLAG', false)).toBe(true);
    });

    it('"false"이면 false를 반환한다', () => {
      const config = mockConfig({ FLAG: 'false' });
      expect(getEnvAsBoolean(config, 'FLAG', true)).toBe(false);
    });

    it('값이 없으면 기본값을 반환한다', () => {
      const config = mockConfig({});
      expect(getEnvAsBoolean(config, 'FLAG', true)).toBe(true);
    });

    it('인식 불가능한 값이면 기본값을 반환한다', () => {
      const config = mockConfig({ FLAG: 'yes' });
      expect(getEnvAsBoolean(config, 'FLAG', false)).toBe(false);
    });
  });
});
