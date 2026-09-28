import {
  DEV_DEFAULT_ORIGINS,
  PROD_ALLOWED_ORIGINS,
  resolveAllowedOrigins,
} from './cors-origins';

describe('resolveAllowedOrigins', () => {
  it('운영은 env와 무관하게 고정 목록이고 관리자 웹 오리진을 포함한다', () => {
    const origins = resolveAllowedOrigins(true, ['http://evil.example']);
    expect(origins).toEqual(PROD_ALLOWED_ORIGINS);
    expect(origins).toContain('https://admin.caquick.site');
    expect(origins).not.toContain('http://evil.example');
  });

  it.each([
    [['http://localhost:5173'], ['http://localhost:5173']],
    [
      ['http://a.test', 'http://b.test'],
      ['http://a.test', 'http://b.test'],
    ],
    [[], DEV_DEFAULT_ORIGINS],
  ])('비운영은 FRONTEND_BASE_URL 목록(%j) → %j', (env, expected) => {
    expect(resolveAllowedOrigins(false, env)).toEqual(expected);
  });

  it('반환값을 바꿔도 원본 목록은 그대로다', () => {
    const origins = resolveAllowedOrigins(true, []);
    origins.push('x');
    expect(PROD_ALLOWED_ORIGINS).not.toContain('x');
  });
});
