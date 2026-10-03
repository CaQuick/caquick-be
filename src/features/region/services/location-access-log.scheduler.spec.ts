import { Logger } from '@nestjs/common';

import { LocationAccessLogScheduler } from '@/features/region/services/location-access-log.scheduler';
import type { LocationAccessLogService } from '@/features/region/services/location-access-log.service';

describe('LocationAccessLogScheduler', () => {
  function build(purgeExpired: jest.Mock): LocationAccessLogScheduler {
    return new LocationAccessLogScheduler({
      purgeExpired,
    } as unknown as LocationAccessLogService);
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('매일 보존 기간이 지난 확인자료를 파기한다', async () => {
    const purge = jest.fn().mockResolvedValue(3);

    await build(purge).handleDaily();

    expect(purge).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      '위치정보 확인자료 3건 파기',
    );
  });

  it('파기 실패는 던지지 않고 로그만 남긴다', async () => {
    const purge = jest.fn().mockRejectedValue(new Error('db down'));

    await expect(build(purge).handleDaily()).resolves.toBeUndefined();

    expect(Logger.prototype.error).toHaveBeenCalled();
  });
});
