import { Logger } from '@nestjs/common';

import { ClockService } from '@/common/providers/clock.service';
import { SearchKeywordRankScheduler } from '@/features/search/services/search-keyword-rank.scheduler';
import type { SearchKeywordRankService } from '@/features/search/services/search-keyword-rank.service';

describe('SearchKeywordRankScheduler', () => {
  const now = new Date('2026-08-31T13:00:00.000Z');

  function build(captureSnapshot: jest.Mock) {
    const clock = new ClockService();
    jest.spyOn(clock, 'now').mockReturnValue(now);
    const service = { captureSnapshot } as unknown as SearchKeywordRankService;
    return new SearchKeywordRankScheduler(service, clock);
  }

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('부팅 시 현재 시각으로 스냅샷 생성을 시도한다', async () => {
    const capture = jest.fn().mockResolvedValue(true);
    const scheduler = build(capture);

    await scheduler.onApplicationBootstrap();

    expect(capture).toHaveBeenCalledWith(now);
  });

  it('정각 크론도 동일하게 스냅샷 생성을 시도한다', async () => {
    const capture = jest.fn().mockResolvedValue(false);
    const scheduler = build(capture);

    await scheduler.handleHourly();

    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('스냅샷 생성 실패는 삼키고 로그만 남긴다', async () => {
    const capture = jest.fn().mockRejectedValue(new Error('db down'));
    const scheduler = build(capture);

    await expect(scheduler.handleHourly()).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });
});
