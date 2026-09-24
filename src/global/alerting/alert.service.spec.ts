import { ConfigService } from '@nestjs/config';

import { ClockService } from '@/common/providers/clock.service';
import type { AlertingConfig } from '@/config/alerting.config';
import { AlertService } from '@/global/alerting/alert.service';
import type { CustomLoggerService } from '@/global/logger/custom-logger.service';

describe('AlertService', () => {
  const START = 1_000_000;
  let nowMs = START;
  const logger = { warn: jest.fn() } as unknown as CustomLoggerService;

  function build(
    config: Partial<AlertingConfig> = {},
    transport = jest.fn().mockResolvedValue(true),
  ) {
    const clock = new ClockService();
    jest.spyOn(clock, 'nowMs').mockImplementation(() => nowMs);
    const cfg: AlertingConfig = {
      discordWebhookUrl: 'https://discord.test/hook',
      dedupeWindowMs: 5_000,
      ...config,
    };
    const service = new AlertService(
      { getOrThrow: () => cfg } as unknown as ConfigService,
      clock,
      logger,
      transport,
    );
    return { service, transport };
  }

  beforeEach(() => {
    nowMs = START;
    jest.clearAllMocks();
  });

  it('웹훅으로 보내고 sent를 돌려준다(출처 role·env 포함)', async () => {
    const { service, transport } = build();

    await expect(
      service.notify({ level: 'error', title: 'outbox FAILED', detail: 'd' }),
    ).resolves.toBe('sent');

    expect(transport).toHaveBeenCalledWith(
      'https://discord.test/hook',
      { level: 'error', title: 'outbox FAILED', detail: 'd' },
      { role: 'api', env: expect.any(String) as string },
    );
  });

  it('같은 key는 억제 창 안에서 한 번만 보내고, 창이 지나면 다시 보낸다', async () => {
    const { service, transport } = build({ dedupeWindowMs: 5_000 });

    await service.notify({ level: 'warn', title: 'redis 폴백' });
    nowMs += 4_999;
    await expect(
      service.notify({ level: 'warn', title: 'redis 폴백' }),
    ).resolves.toBe('suppressed');
    nowMs += 1;
    await expect(
      service.notify({ level: 'warn', title: 'redis 폴백' }),
    ).resolves.toBe('sent');

    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('key가 다르면 억제되지 않는다(title이 같아도)', async () => {
    const { service, transport } = build();

    await service.notify({ level: 'error', title: 'FAILED', key: 'a' });
    await service.notify({ level: 'error', title: 'FAILED', key: 'b' });

    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('웹훅 미설정이면 전송하지 않고 로그만 남긴다(skipped)', async () => {
    const { service, transport } = build({ discordWebhookUrl: null });

    await expect(service.notify({ level: 'error', title: 't' })).resolves.toBe(
      'skipped',
    );

    expect(transport).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('[alert:error] t', {
      detail: undefined,
      delivered: false,
    });
  });

  it('반증: 전송 실패는 failed로 돌려줄 뿐 던지지 않고, 실패도 억제 창을 연다', async () => {
    const { service, transport } = build(
      {},
      jest.fn().mockResolvedValue(false),
    );

    await expect(service.notify({ level: 'error', title: 't' })).resolves.toBe(
      'failed',
    );
    await expect(service.notify({ level: 'error', title: 't' })).resolves.toBe(
      'suppressed',
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
