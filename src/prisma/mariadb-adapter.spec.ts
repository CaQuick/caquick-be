import { withAdapterOptions } from '@/prisma/mariadb-adapter';

describe('withAdapterOptions', () => {
  const BASE =
    'mysql://user:p%40ss@db.example:3307/caquick?ssl=true&connectionLimit=5';

  it('옵션이 없으면 URL을 그대로 돌려준다 (드라이버 옵션 보존)', () => {
    expect(withAdapterOptions(BASE)).toBe(BASE);
    expect(withAdapterOptions(BASE, { allowPublicKeyRetrieval: false })).toBe(
      BASE,
    );
  });

  it('allowPublicKeyRetrieval은 기존 쿼리를 유지한 채 덧붙인다', () => {
    const url = new URL(
      withAdapterOptions(BASE, { allowPublicKeyRetrieval: true }),
    );
    expect(url.searchParams.get('allowPublicKeyRetrieval')).toBe('true');
    expect(url.searchParams.get('ssl')).toBe('true');
    expect(url.searchParams.get('connectionLimit')).toBe('5');
    expect(url.username).toBe('user');
    expect(url.password).toBe('p%40ss');
    expect(url.pathname).toBe('/caquick');
  });

  it('URL에 이미 켜져 있으면 중복 없이 한 번만 남는다', () => {
    const url = withAdapterOptions(`${BASE}&allowPublicKeyRetrieval=true`, {
      allowPublicKeyRetrieval: true,
    });
    expect(url.match(/allowPublicKeyRetrieval/g)).toHaveLength(1);
  });
});
