import outboxConfig from '@/config/outbox.config';

const KEYS = [
  'OUTBOX_DISPATCH_ENABLED',
  'OUTBOX_POLL_INTERVAL_MS',
  'OUTBOX_BATCH_SIZE',
  'OUTBOX_MAX_ATTEMPTS',
  'OUTBOX_PARTITION_CONCURRENCY',
] as const;

describe('outboxConfig', () => {
  const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};
  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('미설정이면 기본값(가동·1s·100·5·4)', () => {
    expect(outboxConfig()).toEqual({
      dispatchEnabled: true,
      pollIntervalMs: 1_000,
      batchSize: 100,
      maxAttempts: 5,
      partitionConcurrency: 4,
    });
  });

  it('env 값을 읽고, dispatchEnabled는 "false"(대소문자·공백 무시)만 끈다', () => {
    process.env.OUTBOX_DISPATCH_ENABLED = ' FALSE ';
    process.env.OUTBOX_POLL_INTERVAL_MS = '250';
    process.env.OUTBOX_BATCH_SIZE = '10';
    process.env.OUTBOX_MAX_ATTEMPTS = '3';
    process.env.OUTBOX_PARTITION_CONCURRENCY = '2';
    expect(outboxConfig()).toEqual({
      dispatchEnabled: false,
      pollIntervalMs: 250,
      batchSize: 10,
      maxAttempts: 3,
      partitionConcurrency: 2,
    });
    process.env.OUTBOX_DISPATCH_ENABLED = 'no';
    expect(outboxConfig().dispatchEnabled).toBe(true);
  });

  it.each([
    ['0', 'OUTBOX_POLL_INTERVAL_MS'],
    ['-1', 'OUTBOX_BATCH_SIZE'],
    ['abc', 'OUTBOX_MAX_ATTEMPTS'],
    ['1.5', 'OUTBOX_PARTITION_CONCURRENCY'],
  ])(
    '반증: %s 같은 비정상 값(%s)은 기본값으로 숨기지 않고 던진다',
    (value, key) => {
      process.env[key] = value;
      expect(() => outboxConfig()).toThrow(key);
    },
  );
});
