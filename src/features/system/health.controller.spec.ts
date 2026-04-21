import { HealthController } from '@/features/system/health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  it('getHealth: status:ok를 반환한다', () => {
    expect(controller.getHealth()).toEqual({ status: 'ok' });
  });

  it('getProfiles: PROFILE/PORT 환경변수를 응답에 포함한다', () => {
    const originalProfile = process.env.PROFILE;
    const originalPort = process.env.PORT;
    process.env.PROFILE = 'test-profile';
    process.env.PORT = '3001';

    const result = controller.getProfiles();
    expect(result).toEqual({
      status: 'ok',
      profile: 'test-profile',
      port: '3001',
    });

    if (originalProfile === undefined) delete process.env.PROFILE;
    else process.env.PROFILE = originalProfile;
    if (originalPort === undefined) delete process.env.PORT;
    else process.env.PORT = originalPort;
  });

  it('getProfiles: PROFILE 미설정이면 unknown 폴백', () => {
    const original = process.env.PROFILE;
    delete process.env.PROFILE;

    expect(controller.getProfiles().profile).toBe('unknown');

    if (original !== undefined) process.env.PROFILE = original;
  });
});
