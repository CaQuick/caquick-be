import { readAdminWebConfig } from '@/config/admin-web.config';

describe('adminWebConfig', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['   ', null],
    ['https://admin.caquick.com', 'https://admin.caquick.com'],
    [' https://admin.caquick.com/ ', 'https://admin.caquick.com'],
    ['https://caquick.com/admin//', 'https://caquick.com/admin'],
    ['http://192.168.75.17:5173', 'http://192.168.75.17:5173'],
  ])('ADMIN_WEB_BASE_URL=%p → %p', (value, expected) => {
    expect(readAdminWebConfig({ ADMIN_WEB_BASE_URL: value }).baseUrl).toBe(
      expected,
    );
  });

  // 틀린 값으로 부팅하면 업무 알림마다 깨진 링크가 나간다
  it.each([
    ['URL이 아님', 'admin.caquick.com'],
    ['http(s)가 아님', 'ftp://admin.caquick.com'],
    ['javascript 스킴', 'javascript:alert(1)'],
    ['쿼리 포함', 'https://admin.caquick.com?x=1'],
    ['해시 포함', 'https://admin.caquick.com/#/tasks'],
  ])('반증: %s이면 부팅을 막는다', (_case, value) => {
    expect(() => readAdminWebConfig({ ADMIN_WEB_BASE_URL: value })).toThrow(
      'ADMIN_WEB_BASE_URL',
    );
  });
});
